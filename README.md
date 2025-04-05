# O.P.E.R.A.T.O.R
 Your AI Companion to operate your computer and accomplish tasks through NLP

# AI Task Automation Application

This application is an AI-powered tool designed to automate complex tasks using natural language instructions. It interacts with web browsers and desktop applications, providing a seamless way to execute tasks autonomously.

## Features

- **Autonomous Task Execution**: Breaks down complex tasks into manageable steps and executes them sequentially.
- **Web Browser Automation**: Performs actions (e.g., clicking, typing, navigating) and queries (e.g., extracting information) on websites.
- **Desktop Automation**: Supports operations on Windows and macOS, including opening, using, and closing applications.
- **Error Handling and Retry Mechanisms**: Ensures robustness with retry logic and alternative approaches on failure.
- **Real-time Progress Tracking**: Provides updates via WebSocket for monitoring task progress.
- **Reporting and Logging**: Generates detailed reports and logs for each task execution.

## Installation

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: Version 14 or higher (download from [nodejs.org](https://nodejs.org/)).
- **MongoDB**: For database operations (install from [mongodb.com](https://www.mongodb.com/)).
- **Puppeteer**: For browser automation (installed via npm).
- **OpenAI API Key**: Obtain from [openai.com](https://openai.com/) for AI capabilities.
- **Hugging Face API Key**: Get from [huggingface.co](https://huggingface.co/) for Midscene AI SDK.

### Setup Steps

Follow these steps to install and set up the application:

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/your-repo/ai-task-automation.git
   cd ai-task-automation