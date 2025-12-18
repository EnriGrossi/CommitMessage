# Offline AI Commit Message Generator

A command-line tool that uses a local AI model to automatically generate Conventional Commit messages from your staged changes.

## 🚀 Features
- **100% Offline**: Runs locally using `node-llama-cpp` and `Qwen 3 4B` (with fallback to Qwen2.5-Coder-1.5B).
- **Private**: Your code never leaves your machine.
- **Fast**: Optimized single-pass analysis (~20s generation).
- **Conventional Commits**: Enforces specific style (feat, fix, chore, etc.) via Grammar.
- **Interactive**: Review, edit, regenerate, or cancel generated messages.
- **Smart Regeneration**: Improved AI parameters for diverse commit message suggestions.

## 📋 Prerequisites
- **Node.js**: Version 18+ recommended.
- **Git**: Installed and available in PATH.
- **Internet**: Required only for the *first run* to download the AI model (~2.5 GB).

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
The tool automatically manages the model file and tries to use the best available model.
- **Primary Model**: Qwen 3 4B (Q4_K_M quantization)
- **Fallback Model**: Qwen2.5-Coder-1.5B-Instruct-GGUF (Enhanced)
- **Location**: `/models/model.gguf` inside the project folder.
- **Size**: ~2.0-2.5 GB (depending on which model is downloaded)
- **Enhancements**: Higher temperature (0.8) and random seed generation for better regeneration variety

## ⚠️ Troubleshooting
- **"ai-commit command not found"**: Try restarting your terminal after running `npm link`.
- **Download Fails**: Delete the `models` folder and retry. The tool supports resuming/retrying.
