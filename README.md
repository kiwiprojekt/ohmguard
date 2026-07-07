# ⚡ OhmGuard
### 100% Client-Side SPICE Safe Operating Area (SOA) & Derating Studio

**OhmGuard** is an automated electronic design validation and waveform analysis web application built for hardware engineers. It ingests SPICE simulation data (`.raw` files) and manufacturer datasheets (`.pdf`) directly in your browser to verify that every component operates safely within its Absolute Maximum Ratings and engineering derating limits.

---

## ✨ Key Features

- **🔒 100% Client-Side & Private**: Built with zero-dependency HTML5, CSS3, and JavaScript. Your proprietary circuit schematics, `.raw` simulation waveforms, and datasheets are processed locally in your browser's memory and **never leave your machine**.
- **📄 Direct PDF Datasheet Auto-Parser**: Integrates Mozilla's **PDF.js** engine with intelligent regex and keyword pattern matching. Simply drag-and-drop a manufacturer datasheet (Analog Devices, Texas Instruments, Vishay, etc.) to automatically extract *Absolute Maximum Ratings* and pin voltage limits—**no LLM backend or API keys required!**
- **⚡ Fast LTspice `.raw` Waveform Parsing**: Instantly parses both Binary and ASCII LTspice `.raw` files, extracting node voltages, differential pin voltages, and component branch currents across tens of thousands of simulation time steps.
- **🛡️ Automated SOA & Derating Engine**: Evaluates peak voltages, time-weighted RMS currents, average power dissipation, and differential stress percentages against user-defined or datasheet-imported rules.

---

## 🚀 Quick Start (Running Locally)

Because OhmGuard is a standalone static web application, no build servers, Node.js packages, or backend databases are required!

1. Clone or download this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ohmguard.git
   cd ohmguard
   ```
2. Open `index.html` directly in any modern web browser (Chrome, Edge, Safari, Firefox):
   ```bash
   open index.html   # macOS
   # or simply double-click index.html in your file explorer
   ```
3. Drag and drop your own LTspice `.raw` simulation files or `.pdf` datasheets onto the workspace to begin validating your designs.

---

## 🌐 Publishing to GitHub Pages

This repository is pre-configured for instant deployment to **GitHub Pages** (including the required `.nojekyll` bypass file).

### Step 1: Create a Remote Repository
Create a new, empty repository on GitHub named `ohmguard` (do not initialize with a README or license).

### Step 2: Push Your Local Repository
Run the following commands from inside the `/Users/michal/Repos/ohmguard` directory:
```bash
git remote add origin https://github.com/YOUR_USERNAME/ohmguard.git
git branch -M main
git push -u origin main
```

### Step 3: Enable GitHub Pages
1. Go to your repository on GitHub and click **Settings**.
2. In the left sidebar, click **Pages**.
3. Under **Build and deployment** > **Source**, select **Deploy from a branch**.
4. Under **Branch**, select **`main`** and folder **`/ (root)`**, then click **Save**.
5. Within 60 seconds, your OhmGuard studio will be live at:  
   `https://YOUR_USERNAME.github.io/ohmguard/`

---

## 📄 License
This project is open-source and available under the MIT License.
