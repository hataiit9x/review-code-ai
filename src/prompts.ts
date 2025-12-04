/**
 * System prompt for code review
 */
export const SYSTEM_PROMPT = 
    "You are a code reviewer. Your role is to identify bugs, performance issues, " +
    "and areas for optimization in the submitted code. You are also responsible for " +
    "providing constructive feedback and suggesting best practices to improve the " +
    "overall quality of the code.";

/**
 * User prompt for code review instructions
 */
export const REVIEW_INSTRUCTIONS = 
    "Next, I will send you each step of the merge request in standard git diff format, your task is:\n" +
    "- Review the code changes (diffs) in the patch and provide feedback.\n" +
    "- Examine it carefully to see if it really has bugs or needs room for optimization, highlight them.\n" +
    "- Do not highlight minor issues and nitpicks.\n" +
    "- Use bullet points if you have multiple comments.\n" +
    "- You don't have to explain what the code does.\n" +
    "- If you think there is no need to optimize or modify, please reply with 666.\n" +
    "Here are the changes that were committed this time:";

/**
 * OpenAI message format
 */
export const openAiSystemMessage = {
    role: "system",
    content: SYSTEM_PROMPT
};

export const openAiUserMessage = {
    role: "user",
    content: REVIEW_INSTRUCTIONS
};

/**
 * Default model configurations
 */
export const DEFAULT_OPENAI_MODEL = "gpt-3.5-turbo";
export const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash-latest";

export const OPENAI_CONFIG = {
    temperature: 0,
    model: DEFAULT_OPENAI_MODEL,
    stream: false,
};

export const GEMINI_SAFETY_SETTINGS = [
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];
