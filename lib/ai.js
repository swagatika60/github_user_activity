// lib/ai.js
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini with your API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Ability 1: Analyze a specific file when the user clicks on it
async function analyzeCode(code, fileName) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `You are an expert senior developer. Analyze the following code from the file: ${fileName}.
    
    Please provide:
    1. A brief summary of what this file does.
    2. A breakdown of its core logic and architecture.
    3. Any notable patterns or execution flows.
    
    Code:
    ${code}`;
    
    const result = await model.generateContent(prompt);
    return result.response.text();
}

// Ability 2: Answer chat questions with context awareness
async function answerRepoQuestion(question, currentFileName, currentFileCode) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    // Build the context string based on whether the user is looking at a file or not
    let context = "The user is asking a general question about the repository.\n\n";
    if (currentFileName && currentFileCode) {
        context = `The user is currently viewing the file: ${currentFileName}.\nHere is the code they are looking at:\n${currentFileCode}\n\n`;
    }
    
    const prompt = `You are an expert AI software architect assisting a developer in exploring a GitHub repository.
    
    Context: ${context}
    User Question: ${question}
    
    Provide a clear, highly technical, and concise answer. Format your response in clean Markdown.`;
    
    const result = await model.generateContent(prompt);
    return result.response.text();
}

module.exports = { analyzeCode, answerRepoQuestion };