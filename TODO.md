### New Todos:
1. Look at the InterSense design doc to see if you are doing everything accordingly
2. look at openAI api for backend
3. Fix the visual bug where requesting a follow up for the stage using the button on the top adds the follow up a little too far down in the stage beyond where the last question is
    - most easily replicable with stage 4 of the script i use currently
    - also implement a feature such that if there were any followup questions generated (of both types) in a previous stage that weren't promoted, they will disappear when a new stage is moved on to.
4. Figure out if it is possible to highlight things by listening to an api call’s response rather than by clicking it manually. That is, how to capture an element (a question) using its id or something else instead of selecting an element by its onclick event listener. 
    - The answer to this should be in the conversation here: https://www.perplexity.ai/search/i-need-this-front-end-solution-GjJeZH_GRRenRBySll9xRA#56
    - Just look for this: "Absolutely, you can highlight any question based on an API response instead of a click! You just need to update the current state from your API callback, and your UI will highlight the question accordingly."

### Old Todos:
1. When you move on to a new stage, the previous stage is grayed out and no part of it can can be edited anymore
2. add follow-up support
3. add the blue dotted line border for these follow up boxes based on what kind of follow up it is
4. When the last stage is also done, there should be a "Finish" button, which when clicked, will show the overview for the last stage and perform any other cleanup or concluding tasks
5. Each stage has a button to generate overview for it (maybe this can be a single button next to the mark button and clicking it will get the overview for the current active stage)
6. Look at the code and figure out how to pass the script/questions dynamically
7. How to display the stages horizontally insted of vertically?
8. Make each question inside a stage node to also be its own separate node
9. Why can't i delete a node when i hit delete/backspace on it anymore?
10. Fix the bug in which the question below the current one gains the attributes of the one prior if a follow-up is added at the current question (easily confirmed by adding mark to question below and then asking for a follow-up question for the current question)
    - probably is just a fix involving the indices of the questions in the stage
