import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import OpenAIRealtimePOC from './OpenAIRealtimePOC';

// Helper: Parse script into columns
function parseScript(text) {
	try {
		const parsed = JSON.parse(text);
		if (Array.isArray(parsed)) return parsed;
	} catch {}
	const lines = text.split('\n');
	const stages = [];
	let currentStage = null;
	lines.forEach((line) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		if (trimmed.startsWith('Stage')) {
			if (currentStage) stages.push(currentStage);
			currentStage = { label: trimmed.replace(/^Stage\s*\d*:\s*/, ''), questions: [] };
		} else if (trimmed.startsWith('-')) {
			if (currentStage) currentStage.questions.push(trimmed.replace(/^-/, '').trim());
		}
	});
	if (currentStage) stages.push(currentStage);
	return stages;
}

function getQuestionBg(isCurrent, similarity) {
	if (!isCurrent) return undefined;
	const opacity = Math.pow(similarity, 2);
	const r = 255;
	const g = 255;
	const b = Math.round(255 * (1 - opacity));
	return `rgba(${r},${g},${b},1)`;
}

const TAG_WORDS = [
	'Insight', 'Follow-up', 'Key', 'Emotion', 'Action', 'Theme', 'Note', 'Highlight', 'Flag', 'Idea'
];

function getRandomWord() {
	return TAG_WORDS[Math.floor(Math.random() * TAG_WORDS.length)];
}

function getRandomSummary() {
	return Array.from({ length: 3 })
		.map(() => TAG_WORDS[Math.floor(Math.random() * TAG_WORDS.length)])
		.join(', ');
}

function getRandomFollowup() {
	const followups = [
		"Can you elaborate on that?",
		"Why do you think that is?",
		"How did that make you feel?",
		"What happened next?",
		"Can you give an example?",
		"What would you do differently?",
		"How important is that to you?",
		"What led you to that decision?",
		"How often does this occur?",
		"What else comes to mind?"
	];
	return followups[Math.floor(Math.random() * followups.length)];
}

const defaultScript = `Stage 1: Decision to Open Netflix
- On an average day, why do you open up Netflix?
- Tell us about the times of day you watch?
- Who is with you when you are watching Netflix?
- What [other things] are you doing when you are watching?
- Tell us about your mood when you are watching?

Stage 2: Content Discovery
- Once you have Netflix open, how do you choose what to watch?
- Describe your strategies to find recommended content. What do you usually end up watching?
- How do you get recommendations? How often are these from friends/family or other sources? How often from Netflix?
- Which of these recommendations are most valuable to you?
- What does it feel like to find something not recommended vs. something recommended?
- How do you feel about recommendation engines supporting you in discovering new content?

Stage 3: Content Consumption
- Can you describe a time when Netflix started playing the next episode/movie automatically?
- How long do you tend to watch Netflix content at a time?
- If you are watching a TV show, do you tend to watch one or more than one episode at a time?
- What are your thoughts on how Netflix releases episodes—weekly or whole seasons at once?
- If you finish a movie, do you tend to watch another one? What do you do when you see the recommendation starting to be played automatically?
`;
// const defaultScript = ``;

function App() {
	// ...existing state...
	const [scriptText, setScriptText] = useState(defaultScript);
	const [stages, setStages] = useState(parseScript(defaultScript));
	const [scriptLoaded, setScriptLoaded] = useState(false);
	const [researchQuestion, setResearchQuestion] = useState('We extend this work by investigating the design elements of Netflix, the most used SVOD, for the impact they have on users\' senses of agency.');
	const [background, setBackground] = useState('Users often turn to subscription video on demand (SVOD) platforms for entertainment. However, these platforms sometimes employ manipulative tactics that undermine a user\'s sense of agency over time and content choice to increase their share of a user\'s attention. Prior research has investigated how interface designs affect a user\'s sense of agency on social media and YouTube. For example, YouTube\'s autoplay left users feeling like they had less control over their time');
	const [current, setCurrent] = useState({ stageIdx: null, qIdx: null });
	// Fixed highlight intensity
	const similarity = 0.5;
	const [visited, setVisited] = useState([]); // Only declare ONCE
	const [tags, setTags] = useState({});
	const [summaries, setSummaries] = useState({});
	const [showOverview, setShowOverview] = useState({});
	const [finished, setFinished] = useState(false);
	const [lastCompletedStageIdx, setLastCompletedStageIdx] = useState(null);
	// Per-question follow-ups ("?" button)
	const [followups, setFollowups] = useState({});
	// Per-stage follow-up at end (green dotted)
	const [stageFollowups, setStageFollowups] = useState({}); // { [stageIdx]: string|null }

	const maxQuestions = Math.max(...stages.map(s => s.questions.length));

	// ...all your existing handlers...

	function handleLoadScript(e) {
		e.preventDefault();
		const parsed = parseScript(scriptText);
		if (parsed.length === 0) {
			alert('No stages/questions found. Please check your format.');
			return;
		}
		setStages(parsed);
		setCurrent({ stageIdx: null, qIdx: null });
		setVisited([]);
		setTags({});
		setSummaries({});
		setShowOverview({});
		setFinished(false);
		setLastCompletedStageIdx(null);
		setFollowups({});
		setStageFollowups({});
		setIsRealtimeActive(false);
		setScriptLoaded(true);
	}



	function isVisited(stageIdx, qIdx) {
		return visited.some(v => v.stageIdx === stageIdx && v.qIdx === qIdx);
	}

	function getStageStatus(idx) {
		if (current.stageIdx === idx) return 'current';
		if (idx < current.stageIdx) return 'past';
		return 'future';
	}

	function handleQuestionClick(stageIdx, qIdx) {
		if (!stages[stageIdx]?.questions[qIdx]) return;
		if (getStageStatus(stageIdx) === 'past' || finished) return;
		setCurrent({ stageIdx, qIdx });
		setVisited((prev) => {
			if (prev.some((v) => v.stageIdx === stageIdx && v.qIdx === qIdx)) return prev;
			return [...prev, { stageIdx, qIdx }];
		});
		setLastCompletedStageIdx(stageIdx);
	}

	function handleAddQuestion(stageIdx) {
		if (getStageStatus(stageIdx) === 'past' || finished) return;
		setStages((prevStages) => {
			const newStages = prevStages.map((stage, idx) => {
				if (idx !== stageIdx) return stage;
				return {
					...stage,
					questions: [
						...stage.questions,
						`Random question ${stage.questions.length + 1} (dev)`
					]
				};
			});
			return newStages;
		});
	}

	function handleDeleteQuestion(stageIdx, qIdx) {
		if (getStageStatus(stageIdx) === 'past' || finished) return;
		setStages((prevStages) => {
			const newStages = prevStages.map((stage, idx) => {
				if (idx !== stageIdx) return stage;
				return {
					...stage,
					questions: stage.questions.filter((_, i) => i !== qIdx)
				};
			});
			return newStages;
		});
		setVisited((prev) =>
			prev.filter((v) => !(v.stageIdx === stageIdx && v.qIdx === qIdx))
		);
		if (current.stageIdx === stageIdx && current.qIdx === qIdx) {
			setCurrent({ stageIdx: null, qIdx: null });
		}
		setTags((prevTags) => {
			const newTags = { ...prevTags };
			delete newTags[`${stageIdx}_${qIdx}`];
			return newTags;
		});
		setFollowups((prev) => {
			const newF = { ...prev };
			delete newF[`${stageIdx}_${qIdx}`];
			return newF;
		});
	}

	function handleMark(stageIdx, qIdx) {
		if (stageIdx === null || qIdx === null) return;
		if (getStageStatus(stageIdx) === 'past' || finished) return;
		const key = `${stageIdx}_${qIdx}`;
		setTags((prev) => {
			const existingTags = prev[key] || [];
			const newTag = { word: getRandomWord(), dropdownOpen: false, isEditing: false };
			return {
				...prev,
				[key]: Array.isArray(existingTags) ? [...existingTags, newTag] : [newTag]
			};
		});
	}

	function handleAdd(stageIdx, qIdx) {
		if (stageIdx === null || qIdx === null) return;
		if (getStageStatus(stageIdx) === 'past' || finished) return;
		const key = `${stageIdx}_${qIdx}`;
		setTags((prev) => {
			const existingTags = prev[key] || [];
			const newTag = { word: '', dropdownOpen: false, isEditing: true };
			return {
				...prev,
				[key]: Array.isArray(existingTags) ? [...existingTags, newTag] : [newTag]
			};
		});
	}

	React.useEffect(() => {
		if (current.stageIdx !== null && current.stageIdx > 0) {
			const prevIdx = current.stageIdx - 1;
			if (!summaries[prevIdx]) {
				setSummaries((prev) => ({
					...prev,
					[prevIdx]: getRandomSummary()
				}));
			}
		}
	}, [current.stageIdx]); // eslint-disable-line

	function handleFinish() {
		const lastIdx = stages.length - 1;
		if (!summaries[lastIdx]) {
			setSummaries((prev) => ({
				...prev,
				[lastIdx]: getRandomSummary()
			}));
		}
		setShowOverview((prev) => ({
			...prev,
			[lastIdx]: true
		}));
		setFinished(true);
		setCurrent({ stageIdx: null, qIdx: null });
		setLastCompletedStageIdx(stages.length - 1);
		setIsRealtimeActive(false);
	}

	function TagShape({ word, onClick, isEditing = false, onEdit = null }) {
		// Ensure word is a string and handle undefined/null cases
		const safeWord = word || '';
		const inputRef = React.useRef(null);
		
		// Calculate width based on text length
		const textWidth = Math.max(safeWord.length * 8, 60); // Minimum 60px, 8px per character
		const totalWidth = textWidth + 20; // Add padding for the tag shape
		
		return (
			<div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
				<svg
					width={totalWidth}
					height={40}
					style={{ cursor: 'pointer', display: 'block' }}
					onClick={e => {
						e.stopPropagation();
						if (isEditing) {
							// If editing, complete the edit
							// console.log('inputRef.current:', inputRef.current);
							// console.log('inputRef.current.value:', inputRef.current?.value);
							const currentValue = inputRef.current ? inputRef.current.value : safeWord;
							// console.log('currentValue:', currentValue);
							onEdit && onEdit(currentValue, true);
						} else {
							// If not editing, handle normal click
							onClick && onClick(e);
						}
					}}
				>
					<polygon
						points={`0,0 ${textWidth},0 ${totalWidth},20 ${textWidth},40 0,40`}
						fill="#1976d2"
						stroke="#1250a3"
						strokeWidth="2"
					/>
					{isEditing ? (
						<foreignObject x="10" y="8" width={textWidth} height="24">
							<input
								ref={inputRef}
								type="text"
								value={safeWord}
								onChange={(e) => onEdit && onEdit(e.target.value, false)}
								// onBlur={() => {
								// 	console.log('onBlur - inputRef.current:', inputRef.current);
								// 	console.log('onBlur - inputRef.current.value:', inputRef.current?.value);
								// 	const currentValue = inputRef.current ? inputRef.current.value : safeWord;
								// 	console.log('onBlur - currentValue:', currentValue);
								// 	onEdit && onEdit(currentValue, true);
								// }}
								onKeyPress={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										const currentValue = inputRef.current ? inputRef.current.value : safeWord;
										onEdit && onEdit(currentValue, true);
									}
								}}
								onClick={(e) => e.stopPropagation()}
								style={{
									width: '100%',
									height: '100%',
									border: 'none',
									background: 'transparent',
									color: '#fff',
									fontSize: '16px',
									fontWeight: 'bold',
									textAlign: 'center',
									outline: 'none',
									padding: 0,
									margin: 0,
									fontFamily: 'inherit',
								}}
								autoFocus
								placeholder="Enter text..."
							/>
						</foreignObject>
					) : (
						<text
							x={totalWidth / 2}
							y="25"
							textAnchor="middle"
							fill="#fff"
							fontSize="16"
							fontWeight="bold"
							style={{ pointerEvents: 'none', userSelect: 'none' }}
						>
							{safeWord}
						</text>
					)}
				</svg>
			</div>
		);
	}

	function TagDropdown({ onSelect, onClose }) {
		return (
			<div
				style={{
					position: 'absolute',
					background: '#fff',
					border: '1px solid #1976d2',
					borderRadius: 6,
					boxShadow: '0 2px 8px #0002',
					zIndex: 100,
					marginTop: 4,
					left: '50%',
					transform: 'translateX(-50%)',
					minWidth: 100,
				}}
			>
				{TAG_WORDS.map((word) => (
					<div
						key={word}
						onClick={() => { onSelect(word); onClose(); }}
						style={{
							padding: '8px 16px',
							cursor: 'pointer',
							color: '#1976d2',
							fontWeight: 'bold',
							borderBottom: '1px solid #e0e0e0',
							background: '#f5faff',
							transition: 'background 0.2s',
						}}
						onMouseDown={e => e.preventDefault()}
						onMouseOver={e => e.currentTarget.style.background = '#e3f0ff'}
						onMouseOut={e => e.currentTarget.style.background = '#f5faff'}
					>
						{word}
					</div>
				))}
			</div>
		);
	}

	function toggleTagDropdown(stageIdx, qIdx, tagIndex = 0) {
		const key = `${stageIdx}_${qIdx}`;
		setTags((prev) => {
			const newTags = { ...prev };
			Object.keys(newTags).forEach(k => {
				if (k === key) {
					newTags[k] = Array.isArray(newTags[k]) ? [...newTags[k]] : [newTags[k]];
					newTags[k][tagIndex] = { ...newTags[k][tagIndex], dropdownOpen: !newTags[k][tagIndex].dropdownOpen };
				} else {
					newTags[k] = { ...newTags[k], dropdownOpen: false };
				}
			});
			return newTags;
		});
	}

	function setTagWord(stageIdx, qIdx, word, tagIndex = 0, keepEditing = false) {
		const key = `${stageIdx}_${qIdx}`;
		const safeWord = word || '';
		console.log('safeWord', safeWord);
		setTags((prev) => {
			const existingTags = prev[key] || [];
			console.log('existingTags', existingTags);
			if (Array.isArray(existingTags)) {
				const newTags = [...existingTags];
				newTags[tagIndex] = { 
					...newTags[tagIndex], 
					word: safeWord, 
					dropdownOpen: false,
					isEditing: keepEditing ? newTags[tagIndex].isEditing : false
				};
				return { ...prev, [key]: newTags };
			} else {
				return { ...prev, [key]: { word: safeWord, dropdownOpen: false, isEditing: keepEditing ? prev[key]?.isEditing : false } };
			}
		});
	}

	function closeAllTagDropdowns() {
		setTags((prev) => {
			const newTags = { ...prev };
			Object.keys(newTags).forEach(k => {
				newTags[k] = { ...newTags[k], dropdownOpen: false };
			});
			return newTags;
		});
	}

	function toggleOverview(idx) {
		setShowOverview((prev) => ({
			...prev,
			[idx]: !prev[idx]
		}));
	}

	// --- Per-question follow-up logic ---
	function handleAddFollowup(stageIdx, qIdx) {
		const key = `${stageIdx}_${qIdx}`;
		setFollowups(prev => ({
			...prev,
			[key]: getRandomFollowup()
		}));
	}

	function handlePromoteFollowup(stageIdx, qIdx) {
		const key = `${stageIdx}_${qIdx}`;
		setStages(prevStages => {
			const newStages = prevStages.map((stage, idx) => {
				if (idx !== stageIdx) return stage;
				const questions = [...stage.questions];
				questions.splice(qIdx + 1, 0, followups[key]);
				return { ...stage, questions };
			});
			return newStages;
		});

		// Shift tags
		setTags(prev => {
			const next = { ...prev };
			const keys = Object.keys(next);
			for (let i = keys.length - 1; i >= 0; i--) {
				const k = keys[i];
				const [s, q] = k.split('_').map(Number);
				if (s === stageIdx && q > qIdx) {
					next[`${s}_${q + 1}`] = next[k];
					delete next[k];
				}
			}
			return next;
		});

		// Shift visited
		setVisited(prev =>
			prev.map(v =>
				v.stageIdx === stageIdx && v.qIdx > qIdx
					? { ...v, qIdx: v.qIdx + 1 }
					: v
			)
		);

		// Shift followups
		setFollowups(prev => {
			const next = { ...prev };
			const keys = Object.keys(next);
			for (let i = keys.length - 1; i >= 0; i--) {
				const k = keys[i];
				const [s, q] = k.split('_').map(Number);
				if (s === stageIdx && q > qIdx) {
					next[`${s}_${q + 1}`] = next[k];
					delete next[k];
				}
			}
			// Remove the promoted followup
			delete next[key];
			return next;
		});

		// Set the new question as current
		setCurrent({ stageIdx, qIdx: qIdx + 1 });
		setVisited(prev => [...prev, { stageIdx, qIdx: qIdx + 1 }]);
		setLastCompletedStageIdx(stageIdx);
	}

	// --- Per-stage follow-up logic ---
	function handleAddStageFollowup() {
		if (current.stageIdx === null || getStageStatus(current.stageIdx) !== 'current' || finished) return;
		const sIdx = current.stageIdx;
		if (stageFollowups[sIdx]) return; // Only one at a time
		setStageFollowups(prev => ({
			...prev,
			[sIdx]: getRandomFollowup()
		}));
	}

	function handlePromoteStageFollowup(stageIdx) {
		setStages(prevStages => {
			const newStages = prevStages.map((stage, idx) => {
				if (idx !== stageIdx) return stage;
				const questions = [...stage.questions, stageFollowups[stageIdx]];
				return { ...stage, questions };
			});
			return newStages;
		});
		// Set the new question as current
		setCurrent({ stageIdx, qIdx: stages[stageIdx].questions.length });
		setVisited(prev => [...prev, { stageIdx, qIdx: stages[stageIdx].questions.length }]);
		setLastCompletedStageIdx(stageIdx);
		setStageFollowups(prev => {
			const next = { ...prev };
			delete next[stageIdx];
			return next;
		});
	}

	// Get all stages' questions as a script string
	const allQuestions = stages.flatMap(stage => stage.questions);
	const scriptForAPI = allQuestions.map(q => `- ${q}`).join('\n');

	// Track detected question from POC
	const [detectedQuestion, setDetectedQuestion] = useState('');
	const [isRealtimeActive, setIsRealtimeActive] = useState(false);
	const [transcriptions, setTranscriptions] = useState([]);
	const realtimePOCRef = useRef(null);

	async function handleTranscribeLast30s() {
		if (!realtimePOCRef.current || !realtimePOCRef.current.getLast5SecondsAudio) {
			alert("Audio buffer not available.");
			return;
		}
		const audioBlob = await realtimePOCRef.current.getLast5SecondsAudio();
		if (!audioBlob) {
			alert("No audio available for transcription.");
			return;
		}
		console.log('Sending audioBlob:', audioBlob.size, audioBlob.type); // Debug
		const result = await transcribeAndDiarize(audioBlob);
		console.log('Transcription result:', result);
		setTranscriptions(prev => [...prev, result]);
	}

	// Dummy stub for API call
	async function transcribeAndDiarize(audioBlob) {
		const formData = new FormData();
		// Use WAV extension since we're creating WAV files
		formData.append('audio', audioBlob, 'audio.wav');
		try {
			const response = await fetch('http://localhost:3001/api/transcribe', {
				method: 'POST',
				body: formData,
			});
			if (!response.ok) {
				throw new Error('Transcription failed');
			}
			const data = await response.json();
			return {
				timestamp: new Date().toISOString(),
				transcript: data.transcript,
				speakers: data.speakers || [],
				raw: data.raw, // for debugging
			};
		} catch (err) {
			return {
				timestamp: new Date().toISOString(),
				transcript: '[Transcription failed: ' + err.message + ']',
				speakers: [],
			};
		}
	}

	// When detectedQuestion changes, find which stage and question it matches
	React.useEffect(() => {
		if (detectedQuestion) {
			// Find which stage and question the detected question matches
			for (let stageIdx = 0; stageIdx < stages.length; stageIdx++) {
				const stage = stages[stageIdx];
				const questionIdx = stage.questions.findIndex(q => q.trim() === detectedQuestion.trim());
				if (questionIdx !== -1) {
					// Found a match, update current stage and question
					setCurrent({ stageIdx, qIdx: questionIdx });
					// Add to visited if not already
					setVisited(prev => {
						if (prev.some(v => v.stageIdx === stageIdx && v.qIdx === questionIdx)) return prev;
						return [...prev, { stageIdx, qIdx: questionIdx }];
					});
					break;
				}
			}
		}
		// eslint-disable-next-line
	}, [detectedQuestion, stages]);

	function isVisited(stageIdx, qIdx) {
		return visited.some(v => v.stageIdx === stageIdx && v.qIdx === qIdx);
	}

	// Stage navigation logic
	function canSwitchToStage(idx) {
		if (finished) return false;
		if (idx === 0) return true;
		// Allow switching to next stage if at least one question in the current stage is visited
		if (current.stageIdx !== null && idx === current.stageIdx + 1) {
			const hasVisited = visited.some(v => v.stageIdx === current.stageIdx);
			return hasVisited;
		}
		// Prevent going back to previous stages
		if (idx < current.stageIdx) return false;
		return false;
	}

	function handleStageSwitch(idx) {
		if (canSwitchToStage(idx)) {
			setCurrent({ stageIdx: idx, qIdx: null });
			setDetectedQuestion('');
			setIsRealtimeActive(false);
		}
	}

	return (
		<div style={{ padding: 32, background: '#f8f8f8', minHeight: '100vh' }}>
			{!scriptLoaded ? (
				// Load Script Page
				<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
					<form
						onSubmit={handleLoadScript}
						style={{
							background: '#fff',
							padding: 40,
							borderRadius: 12,
							boxShadow: '0 4px 20px #0001',
							minWidth: 600,
							maxWidth: 900,
						}}
					>
						<div style={{ fontWeight: 'bold', fontSize: 24, marginBottom: 20, textAlign: 'center' }}>
							Interview Script Setup
						</div>
						
						{/* Research Question and Background */}
						<div style={{ marginBottom: 20 }}>
							<div style={{ fontWeight: 'bold', marginBottom: 8, fontSize: 16 }}>
								Research Question & Background:
							</div>
							<div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
								<div style={{ flex: '1 1 0', minWidth: 0 }}>
									<div style={{ fontSize: 14, marginBottom: 4, color: '#666' }}>
										Research Question:
									</div>
									<textarea
										value={researchQuestion}
										onChange={(e) => setResearchQuestion(e.target.value)}
										rows={3}
										style={{
											width: '100%',
											padding: 12,
											borderRadius: 6,
											border: '1px solid #ccc',
											fontSize: 14,
											fontFamily: 'inherit',
											resize: 'vertical',
											boxSizing: 'border-box',
										}}
										placeholder="Enter your research question..."
									/>
								</div>
								<div style={{ flex: '1 1 0', minWidth: 0 }}>
									<div style={{ fontSize: 14, marginBottom: 4, color: '#666' }}>
										Background:
									</div>
									<textarea
										value={background}
										onChange={(e) => setBackground(e.target.value)}
										rows={3}
										style={{
											width: '100%',
											padding: 12,
											borderRadius: 6,
											border: '1px solid #ccc',
											fontSize: 14,
											fontFamily: 'inherit',
											resize: 'vertical',
											boxSizing: 'border-box',
										}}
										placeholder="Enter background information..."
									/>
								</div>
							</div>
						</div>

						{/* Interview Script */}
						<div style={{ marginBottom: 20 }}>
							<div style={{ fontWeight: 'bold', marginBottom: 8, fontSize: 16 }}>
								Interview Script:
							</div>
							<textarea
								value={scriptText}
								onChange={(e) => setScriptText(e.target.value)}
								rows={15}
								style={{
									width: '100%',
									marginBottom: 20,
									padding: 12,
									borderRadius: 8,
									border: '1px solid #ccc',
									fontFamily: 'monospace',
									fontSize: 14,
									resize: 'vertical',
								}}
								placeholder="Paste your interview script here..."
							/>
						</div>

						<div style={{ textAlign: 'center' }}>
							<button
								type="submit"
								style={{
									background: '#1976d2',
									color: '#fff',
									border: 'none',
									borderRadius: 6,
									padding: '12px 32px',
									fontWeight: 'bold',
									fontSize: 16,
									cursor: 'pointer',
								}}
							>
								Load Script
							</button>
						</div>
					</form>
				</div>
			) : (
				// Interview Script Page
				<>
					{/* Show the POC when active */}
					{isRealtimeActive && (
						<div style={{ marginBottom: 32 }}>
							<OpenAIRealtimePOC
								ref={realtimePOCRef}
								key="realtime-poc"
								script={scriptForAPI}
								onDetectedQuestion={setDetectedQuestion}
								autoStart={isRealtimeActive}
							/>
						</div>
					)}
					<div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
						<button
							type="button"
							onClick={isRealtimeActive ? handleFinish : () => setIsRealtimeActive(true)}
							style={{
								background: isRealtimeActive ? '#388e3c' : '#1976d2',
								color: '#fff',
								border: 'none',
								borderRadius: 4,
								padding: '8px 18px',
								fontWeight: 'bold',
								fontSize: 16,
								cursor: 'pointer',
								opacity: 1,
								boxShadow: '0 1px 4px #0001',
							}}
						>
							{isRealtimeActive ? 'Finish' : 'Start'}
						</button>
						<button
							type="button"
							onClick={handleTranscribeLast30s}
							style={{
								background: '#ff9800',
								color: '#fff',
								border: 'none',
								borderRadius: 4,
								padding: '8px 18px',
								fontWeight: 'bold',
								fontSize: 16,
								cursor: isRealtimeActive ? 'pointer' : 'not-allowed',
								opacity: isRealtimeActive ? 1 : 0.5,
								boxShadow: '0 1px 4px #0001',
							}}
							disabled={!isRealtimeActive}
						>
							Transcribe Last 30s
						</button>
					</div>
					{/* Show transcriptions */}
					{transcriptions.length > 0 && (
						<div style={{ margin: '24px 0', background: '#fffbe6', borderRadius: 8, padding: 16 }}>
							<div style={{ fontWeight: 'bold', marginBottom: 8 }}>On-Demand Transcriptions (Last 30s)</div>
							{transcriptions.map((t, i) => (
								<div key={i} style={{ marginBottom: 8 }}>
									<div style={{ fontSize: 13, color: '#888' }}>{t.timestamp}</div>
									<pre style={{ margin: 0, fontSize: 14 }}>{t.transcript}</pre>
								</div>
							))}
						</div>
					)}
					<div
						style={{
							display: 'grid',
							gridTemplateColumns: `repeat(${stages.length}, 1fr)`,
							gap: 24,
							background: '#fff',
							borderRadius: 8,
							boxShadow: '0 2px 8px #0001',
							padding: 24,
							overflowX: 'auto',
							position: 'relative',
						}}
						// onClick={closeAllTagDropdowns}
					>
				{stages.map((stage, idx) => {
					const status = getStageStatus(idx);
					let stageBg = '#f0f0f0';
					let stageColor = '#222';
					let borderWidth = 2;
					let borderStyle = 'solid';
					let borderColor = '#e0e0e0';
					let boxShadow = '0 1px 4px #0001';
					if (status === 'past') {
						stageBg = '#e0e0e0';
						stageColor = '#888';
						borderColor = '#d0d0d0';
						borderWidth = 2;
					} else if (status === 'current') {
						stageBg = '#fffbe6';
						stageColor = '#222';
						borderColor = '#ffeb3b'; // bright yellow for active
						borderWidth = 3;
						boxShadow = 'none';
					}
					const showStageOverview = (status === 'past' || (status === 'current' && summaries[idx] && showOverview[idx] === true));
					return (
						<div
							key={idx}
							style={{
								background: stageBg,
								color: stageColor,
								borderStyle,
								borderWidth,
								borderColor,
								borderRadius: 10,
								boxShadow,
								padding: 12,
								marginBottom: 8,
								marginTop: 0,
								minHeight: 60 + 48 * maxQuestions,
								display: 'flex',
								flexDirection: 'column',
								alignItems: 'stretch',
								transition: 'background 0.2s, color 0.2s, border 0.2s',
								position: 'relative',
								overflow: 'visible',
							}}
						>
							<div
								style={{
									fontWeight: 'bold',
									fontSize: 20,
									textAlign: 'center',
									marginBottom: 16,
									borderBottom: '2px solid #1976d2',
									paddingBottom: 8,
									background: 'transparent',
									color: stageColor,
									borderRadius: 6,
									transition: 'background 0.2s, color 0.2s',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									gap: 8,
								}}
							>
								{`Stage ${idx + 1}: ${stage.label}`}
								{/* <button
									type="button"
									onClick={() => handleStageSwitch(idx)}
									disabled={!canSwitchToStage(idx)}
									style={{
										marginLeft: 8,
										background: '#1976d2',
										color: '#fff',
										border: 'none',
										borderRadius: 4,
										padding: '2px 10px',
										fontWeight: 'bold',
										fontSize: 16,
										cursor: !canSwitchToStage(idx) ? 'not-allowed' : 'pointer',
										opacity: !canSwitchToStage(idx) ? 0.5 : 1,
										lineHeight: 1,
									}}
									title="Switch to this stage"
								>
									Go
								</button> */}
							</div>
							{showOverview[idx] === true && (
								<div style={{
									background: 'orange',
									color: '#fff',
									borderRadius: 8,
									padding: '14px 12px',
									fontWeight: 'bold',
									fontSize: 15,
									boxShadow: '0 2px 8px #0002',
									marginBottom: 12,
									marginTop: 0,
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
								}}>
									<div>
										<div style={{ fontSize: 13, marginBottom: 4, opacity: 0.85 }}>
											Stage {idx + 1} Overview
										</div>
										<div>{summaries[idx]}</div>
									</div>
									<button
										onClick={e => { e.stopPropagation(); toggleOverview(idx); }}
										style={{
											marginLeft: 16,
											background: 'transparent',
											border: 'none',
											color: '#fff',
											fontSize: 18,
											cursor: 'pointer',
											padding: 0,
											lineHeight: 1,
										}}
										aria-label="Hide overview"
									>▲</button>
								</div>
							)}
							{status === 'past' && summaries[idx] && showOverview[idx] === false && (
								<button
									onClick={e => { e.stopPropagation(); toggleOverview(idx); }}
									style={{
										background: 'orange',
										color: '#fff',
										border: 'none',
										borderRadius: 6,
										padding: '4px 10px',
										fontWeight: 'bold',
										cursor: 'pointer',
										zIndex: 10,
										marginBottom: 12,
										marginTop: 0,
										alignSelf: 'flex-end',
									}}
									aria-label="Show overview"
								>Show Overview</button>
							)}
							{Array.from({ length: Math.max(maxQuestions, stage.questions.length) }).map((_, rowIdx) => {
								const isCurrent = current.stageIdx === idx && current.qIdx === rowIdx;
								const isDetected = isCurrent && detectedQuestion && stage.questions[rowIdx]?.trim() === detectedQuestion.trim();
								const isVisitedQ = isVisited(idx, rowIdx);
								// Only highlight if detected by model or visited
								let bg = '';
								let color = '#222';
								if (isDetected){
									bg = '#fffbe6';  // 浅黄色背景
									color = '#222';  // 保持文字颜色不变
								} else if (isVisitedQ) {
									bg = '#e0e0e0';  // 浅黄色背景
									color = '#222';  // 保持文字颜色不变
								} else if (stage.questions[rowIdx]) {
									bg = '#f5faff';
									color = '#222';
								}
								return (
									<div
										key={`${rowIdx}-${idx}`}
										style={{
											minHeight: 40,
											margin: 2,
											borderRadius: 6,
											background: bg,
											color,
											fontSize: 15,
											border: stage.questions[rowIdx] ? '1px solid #b6d4fa' : 'none',
											transition: 'background 0.2s, color 0.2s',
											opacity: stage.questions[rowIdx] ? 1 : 0,
											boxShadow: isCurrent ? '0 0 0 2px #ffeb3b' : undefined,
											display: 'flex',
											flexDirection: 'column',
											position: 'relative',
											padding: 0,
											pointerEvents: 'auto', // Enable click
											userSelect: 'none', // Disable click
										}}
										tabIndex={stage.questions[rowIdx] ? 0 : -1}
										aria-label={stage.questions[rowIdx] || ''}
									>
										<div
											style={{
												display: 'flex',
												alignItems: 'center',
												width: '100%',
												padding: '8px 6px',
											}}
										>
											<span style={{ flex: 1 }}>{stage.questions[rowIdx] || ''}</span>
										</div>
										
										{/* Tags and placeholder container */}
										{stage.questions[rowIdx] && (
											<div
												style={{
													display: 'flex',
													alignItems: 'center',
													gap: 8,
													margin: '4px 6px',
													flexWrap: 'wrap',
												}}
											>
												{/* Tags container */}
												<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
													{tags[`${idx}_${rowIdx}`] && Array.isArray(tags[`${idx}_${rowIdx}`]) && 
														tags[`${idx}_${rowIdx}`].map((tag, tagIndex) => (
															<TagShape
																key={tagIndex}
																word={tag.word || ''}
																onClick={e => {
																	if (getStageStatus(idx) !== 'past' && !finished) {
																		e.stopPropagation();
																		if ((tag.word || '') === '' || tag.isEditing) {
																			// If tag is empty or already editing, start editing
																			setTags(prev => {
																				const key = `${idx}_${rowIdx}`;
																				const existingTags = prev[key] || [];
																				if (Array.isArray(existingTags)) {
																					const newTags = [...existingTags];
																					newTags[tagIndex] = { ...newTags[tagIndex], isEditing: true };
																					return { ...prev, [key]: newTags };
																				}
																				return prev;
																			});
																		} else {
																			// If tag has content, toggle dropdown
																			toggleTagDropdown(idx, rowIdx, tagIndex);
																		}
																	}
																}}
																isEditing={tag.isEditing}
																onEdit={(newWord, isFinal) => {
																	setTagWord(idx, rowIdx, newWord, tagIndex, !isFinal);
																	console.log('isFinal', isFinal);
																	if (isFinal) {
																		// Update the editing state for single tag
																		setTags(prev => {
																			const key = `${idx}_${rowIdx}`;
																			const existingTags = prev[key] || [];
																			if (Array.isArray(existingTags)) {
																				const newTags = [...existingTags];
																				newTags[tagIndex] = { ...newTags[tagIndex], isEditing: false };
																				return { ...prev, [key]: newTags };
																			}
																			return prev;
																		});
																	}
																}}
															/>
														))
													}
													{tags[`${idx}_${rowIdx}`] && !Array.isArray(tags[`${idx}_${rowIdx}`]) && (
														<TagShape
															word={tags[`${idx}_${rowIdx}`].word || ''}
															onClick={e => {
																if (getStageStatus(idx) !== 'past' && !finished) {
																	e.stopPropagation();
																	const currentTag = tags[`${idx}_${rowIdx}`];
																	if ((currentTag.word || '') === '' || currentTag.isEditing) {
																		// If tag is empty or already editing, start editing
																		setTags(prev => {
																			const key = `${idx}_${rowIdx}`;
																			return { ...prev, [key]: { ...prev[key], isEditing: true } };
																		});
																	} else {
																		// If tag has content, toggle dropdown
																		toggleTagDropdown(idx, rowIdx);
																	}
																}
															}}
															isEditing={tags[`${idx}_${rowIdx}`].isEditing}
															onEdit={(newWord, isFinal) => {
																setTagWord(idx, rowIdx, newWord, 0, !isFinal);
																if (isFinal) {
																	// Update the editing state for single tag
																	setTags(prev => {
																		const key = `${idx}_${rowIdx}`;
																		return { ...prev, [key]: { ...prev[key], isEditing: false } };
																	});
																}
															}}
														/>
													)}
													{tags[`${idx}_${rowIdx}`]?.dropdownOpen && (
														<TagDropdown
															onSelect={word => {
																// Find which tag is open
																const currentTags = tags[`${idx}_${rowIdx}`];
																if (Array.isArray(currentTags)) {
																	const openTagIndex = currentTags.findIndex(tag => tag.dropdownOpen);
																	if (openTagIndex !== -1) {
																		setTagWord(idx, rowIdx, word, openTagIndex);
																	}
																} else {
																	setTagWord(idx, rowIdx, word);
																}
															}}
															// onClose={closeAllTagDropdowns}
														/>
													)}
												</div>
												
												{/* Placeholder area with hover buttons */}
												<div
													style={{
														position: 'relative',
														height: 32,
														borderRadius: 4,
														border: '1px dashed #ddd',
														background: '#fafafa',
														display: 'flex',
														alignItems: 'center',
														justifyContent: 'center',
														transition: 'all 0.2s',
														cursor: 'pointer',
														width: 'fit-content',
														minWidth: 120,
													}}
													onMouseEnter={(e) => {
														e.currentTarget.style.background = '#f0f0f0';
														e.currentTarget.style.borderColor = '#ccc';
													}}
													onMouseLeave={(e) => {
														e.currentTarget.style.background = '#fafafa';
														e.currentTarget.style.borderColor = '#ddd';
													}}
												>
													{/* Hover buttons container */}
													<div
														style={{
															display: 'flex',
															gap: 8,
															opacity: 0,
															transition: 'opacity 0.2s',
														}}
														onMouseEnter={(e) => {
															e.currentTarget.style.opacity = 1;
															// Hide the placeholder text when buttons are visible
															const placeholderText = e.currentTarget.parentElement.querySelector('.placeholder-text');
															if (placeholderText) {
																placeholderText.style.opacity = 0;
															}
														}}
														onMouseLeave={(e) => {
															e.currentTarget.style.opacity = 0;
															// Show the placeholder text when buttons are hidden
															const placeholderText = e.currentTarget.parentElement.querySelector('.placeholder-text');
															if (placeholderText) {
																placeholderText.style.opacity = 1;
															}
														}}
													>
														{/* Mark button */}
														<button
															type="button"
															onClick={e => {
																e.stopPropagation();
																handleMark(idx, rowIdx);
															}}
															disabled={getStageStatus(idx) === 'past' || finished}
															style={{
																background: '#1976d2',
																color: '#fff',
																border: 'none',
																borderRadius: 4,
																padding: '4px 8px',
																fontSize: 12,
																fontWeight: 'bold',
																cursor: getStageStatus(idx) === 'past' || finished ? 'not-allowed' : 'pointer',
																opacity: getStageStatus(idx) === 'past' || finished ? 0.5 : 1,
															}}
															title="Mark this question"
														>
															Mark
														</button>
														
														{/* Add button */}
														<button
															type="button"
															onClick={e => {
																e.stopPropagation();
																handleAdd(idx, rowIdx);
															}}
															disabled={getStageStatus(idx) === 'past' || finished}
															style={{
																background: '#2e7d32',
																color: '#fff',
																border: 'none',
																borderRadius: 4,
																padding: '4px 8px',
																fontSize: 12,
																fontWeight: 'bold',
																cursor: getStageStatus(idx) === 'past' || finished ? 'not-allowed' : 'pointer',
																opacity: getStageStatus(idx) === 'past' || finished ? 0.5 : 1,
															}}
															title="Add tag for this question"
														>
															Add
														</button>
													</div>
													
													{/* Default placeholder text */}
													<span
														className="placeholder-text"
														style={{
															color: '#999',
															fontSize: 12,
															position: 'absolute',
															pointerEvents: 'none',
															transition: 'opacity 0.2s',
														}}
													>
														Hover for actions
													</span>
												</div>
											</div>
										)}
										{/* Follow-up box below the question */}
										{followups[`${idx}_${rowIdx}`] && (
											<div
												style={{
													margin: '8px 0 0 0',
													padding: '12px 14px',
													border: '2px dotted #1976d2',
													borderRadius: 8,
													background: '#fafdff',
													color: '#1976d2',
													fontWeight: 500,
													fontSize: 15,
													boxShadow: '0 1px 4px #1976d222',
													cursor: 'pointer',
													userSelect: 'none',
												}}
												onClick={e => {
													e.stopPropagation();
													handlePromoteFollowup(idx, rowIdx);
												}}
												title="Promote to question"
												aria-label="Promote follow-up to question"
											>
												{followups[`${idx}_${rowIdx}`]}
											</div>
										)}
									</div>
								);
							})}
							{/* Stage-level follow-up at the end */}
							{stageFollowups[idx] && (
								<div
									style={{
										margin: '10px 2px 0 2px',
										padding: '12px 14px',
										border: '2px dotted #2e7d32',
										borderRadius: 8,
										background: '#f6fff6',
										color: '#2e7d32',
										fontWeight: 500,
										fontSize: 15,
										boxShadow: '0 1px 4px #2e7d3222',
										cursor: 'pointer',
										userSelect: 'none',
									}}
									onClick={e => {
										e.stopPropagation();
										handlePromoteStageFollowup(idx);
									}}
									title="Promote to question"
									aria-label="Promote follow-up to question"
								>
									{stageFollowups[idx]}
								</div>
							)}
						</div>
					);
				})}
					</div>
				</>
			)}
		</div>
	);
}

export default App;
