# Offline AI Commit Message Generator

A command-line tool that uses a local AI model to automatically generate Conventional Commit messages from your staged changes.

## 🚀 Features
- **100% Offline**: Runs locally using `node-llama-cpp` and `Qwen2.5-Coder-1.5B` with enhanced generation.
- **Private**: Your code never leaves your machine.
- **Fast**: Optimized single-pass analysis (~20s generation).
- **Conventional Commits**: Enforces specific style (feat, fix, chore, etc.) via Grammar.
- **Interactive**: Review, edit, regenerate, or cancel generated messages.
- **Smart Regeneration**: Improved AI parameters for diverse commit message suggestions.

## 📋 Prerequisites
- **Node.js**: Version 18+ recommended.
- **Git**: Installed and available in PATH.
- **Internet**: Required only for the *first run* to download the AI model (~1.0 GB).

## 🛠️ Installation (New PC)

1. **Clone the Repository**
   ```bash
   git clone <repository_url>
   cd ai-commit-generator
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Make it Global (Optional)**
   This allows you to run `ai-commit` from *any* folder on your computer.
   ```bash
   npm link
   ```

## 🎮 Usage

1. **Stage your changes**
   Go to any of your git projects and stage the files you want to commit.
   ```bash
   git add .
   ```

2. **Run the Generator**
   If you set it up globally:
   ```bash
   ai-commit
   ```
   
   *Or locally:*
   ```bash
   npm start
   ```

3. **Follow the Prompts**
   - The tool will automatically download the AI model (only the first time).
   - It will analyze your staged changes.
   - It will propose a commit message.
   - You can **Confirm**, **Regenerate**, **Edit**, or **Cancel**.

## 🧠 Model Information
The tool automatically manages the model file.
- **Model**: Qwen2.5-Coder-1.5B-Instruct-GGUF (Enhanced)
- **Location**: `/models/model.gguf` inside the project folder.
- **Size**: ~980 MB
- **Enhancements**: Higher temperature (0.8) and random seed generation for better regeneration variety

## ⚠️ Troubleshooting
- **"ai-commit command not found"**: Try restarting your terminal after running `npm link`.
- **Download Fails**: Delete the `models` folder and retry. The tool supports resuming/retrying.
