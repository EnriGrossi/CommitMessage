# Offline AI Commit Message Generator

A command-line tool that uses a local AI model to automatically generate Conventional Commit messages from your staged changes.

## 🚀 Features
- **100% Offline**: Runs locally using `node-llama-cpp` with Qwen3 models.
- **Private**: Your code never leaves your machine.
- **Conventional Commits**: Enforces `<type>(<scope>): <description>` format via grammar constraints and post-validation.
- **Smart Analysis**: Pre-digests diffs to extract meaningful changes, providing structured context to the model for accurate messages.
- **Hardware Auto-Detection**: Automatically recommends the best model for your system based on available RAM.
- **Interactive**: Review, edit, regenerate, suggest improvements, or cancel generated messages.
- **Model Caching**: Reuses loaded models across operations (generation + refinement) for faster workflows.

## 📋 Prerequisites
- **Node.js**: Version 18+ recommended.
- **Git**: Installed and available in PATH.
- **Internet**: Required only for the *first run* to download the AI model.

## 🛠️ Installation

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
   ```bash
   npm link
   ```

4. **Auto-Select the Best Model for Your Hardware**
   ```bash
   ai-commit auto-select
   ```

## 🎮 Usage

1. **Stage your changes**
   ```bash
   git add .
   ```

2. **Run the Generator**
   ```bash
   ai-commit
   ```
   *Or locally:*
   ```bash
   npm start
   ```

3. **Follow the Prompts**
   - The tool will automatically download the AI model on first run.
   - It analyzes your staged changes and proposes a commit message.
   - You can **Commit**, **Regenerate**, **Suggest improvements**, **Edit**, or **Cancel**.

### 🛠️ Commands

| Command | Description |
|---------|-------------|
| `ai-commit` | Generate a commit message from staged changes |
| `ai-commit auto-select [--insecure]` | Detect hardware and automatically select the best model |
| `ai-commit set-model <model> [--insecure]` | Manually set the AI model |
| `ai-commit help` | Show available commands and current model |
| `ai-commit --version` | Show version information |

The `--insecure` flag skips SSL certificate verification during download (useful behind corporate proxies).

## 🧠 Available Models

The tool ships with three Qwen3 model options, all from the official Hugging Face repository:

| Model Key | Name | Size | Min RAM | Best For |
|-----------|------|------|---------|----------|
| `qwen3-1.7b` | Qwen3 1.7B (Q8_0) | 1.83 GB | 4 GB | Low-end machines, quick generation |
| `qwen3-4b` | Qwen3 4B (Q4_K_M) | 2.5 GB | 8 GB | Default, good balance of speed and quality |
| `qwen3-8b` | Qwen3 8B (Q4_K_M) | 5.03 GB | 12 GB | Best quality, recommended if you have the RAM |

Run `ai-commit auto-select` to let the tool pick the best model for your system.

Models are stored in the `models/` folder inside the project directory.

## ⚠️ Troubleshooting
- **"ai-commit command not found"**: Restart your terminal after running `npm link`.
- **Download Fails**: Delete the `models/` folder and retry. The tool detects and removes incomplete downloads automatically.
- **SSL Certificate Issues**: Use the `--insecure` flag (e.g., `ai-commit auto-select --insecure`).
- **Generic commit messages**: Run `ai-commit auto-select` to switch to a larger model. The 1.7B model may produce less specific messages on complex diffs.
