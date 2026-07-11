
<div align="center">
  
# 🚀 <span style="color: #00d2ff;">Search Link Extractor Pro</span> 🔍
  
**Ultimate Enterprise-Grade Web Scraping & Data Extraction Chrome Extension**
  
  [![Version](https://img.shields.io/badge/Version-1.0.0-blueviolet.svg?style=for-the-badge&logo=appveyor)](https://github.com/yourusername/Search-Link-Extractor-Pro/releases)
  [![Platform](https://img.shields.io/badge/Platform-Google_Chrome-yellow.svg?style=for-the-badge&logo=googlechrome)](https://chrome.google.com/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-success.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
  [![Developer](https://img.shields.io/badge/Developer-Mohammed_Mizanur_Rahman-blue.svg?style=for-the-badge)](#-developer)

  <p align="center">
    <br/>
    <i>The most advanced and professional automation tool to extract thousands of search result links, titles, and meta descriptions automatically from Google, Bing, Yahoo, and DuckDuckGo. Purpose-built for SEO, Lead Generation, and Data Mining professionals.</i>
  </p>
</div>

---

## 🌟 Project Overview

**Search Link Extractor Pro** is a robust, Object-Oriented Chrome Extension designed to eliminate the hassle of manual search result collection. It features intelligent auto-pagination, multi-search engine support, and an advanced anti-bot pacing mechanism to prevent CAPTCHA triggers, ensuring a seamless data scraping experience.

---

## 📸 User Interface & Screenshots

<div align="center">
  <img src="https://github.com/user-attachments/assets/b781190a-bc37-4290-af44-1c3185a15a6a" alt="Search Link Extractor Pro Working Animation" width="100%" style="border-radius: 12px; box-shadow: 0 8px 24px rgba(0,210,255,0.2);">
  
  <br><br>
  
  <table width="100%">
    <tr>
      <td width="50%" align="center">
        <b>Modern Glassmorphism Dashboard</b><br><br>
        <img src="https://github.com/user-attachments/assets/1812299f-9d5c-494a-b0b6-99c6bea1709d" alt="Dashboard Interface" width="90%" style="border-radius: 8px;">
      </td>
      <td width="50%" align="center">
        <b>Data Export & History Logs</b><br><br>
        <img src="https://github.com/user-attachments/assets/9996c1c1-ec00-45ae-956b-29763d25a4b9" alt="Export Interface" width="90%" style="border-radius: 8px;">
      </td>
    </tr>
  </table>
</div>

---

## ⚙️ How It Works (System Architecture)

Below is an animated Mermaid.js flowchart demonstrating the underlying Object-Oriented scraping workflow:

```mermaid
graph TD;
    A([🌐 User Input: Keywords & Filters]) --> B{Search Engine Detection};
    B -->|Google/Bing/Yahoo| C[Initialize ScraperEngine Class];
    C --> D[HTML DOM Parsing & Node Traversal];
    D --> E[Extract URL, Title & Snippet];
    E --> F{Smart Deduplication & Filter Check};
    F -->|Blacklisted / Duplicate| G[Discard Data];
    F -->|Unique & Clean| H[Persist in chrome.storage.local];
    H --> I{Next Page Available?};
    I -->|Yes| J[⏳ Randomized Anti-Bot Delay 2-4s];
    J --> C;
    I -->|No| K([📊 Ready for Export: CSV, JSON, TXT]);
    
    style A fill:#0052ff,stroke:#00d2ff,stroke-width:2px,color:#fff
    style C fill:#0d0e12,stroke:#00d2ff,stroke-width:2px,color:#fff
    style K fill:#2bd576,stroke:#fff,stroke-width:2px,color:#111

```

---

## 🔥 Core Features

Engineered for enterprise-level performance, this extension packs the following capabilities:

1. 🌍 **Multi-Engine Support:** Dynamically adapts CSS selectors to scrape from **Google, Bing, Yahoo, and DuckDuckGo**.
2. 🤖 **Auto-Pagination Engine:** Automatically detects and clicks the "Next" button, traversing through hundreds of SERPs without manual intervention.
3. 🛡️ **Anti-Bot Protection:** Implements asynchronous, randomized human-like delays (2 to 4 seconds) between page transitions to bypass IP bans and CAPTCHAs.
4. 🧠 **Smart Filtering & Deduplication:** Ensures absolute unique URLs utilizing a JavaScript `Set`. Includes an input field to blacklist specific domains (e.g., `wikipedia.org`).
5. 📂 **Multi-Format Export:** Download your enriched dataset with a single click in **CSV, JSON, or TXT** formats.
6. 🎨 **Premium UI/UX:** Built with a stunning dark Glassmorphism theme, CSS keyframe animations, live progress monitoring, and interactive tooltips.

---

## 📥 Output Formats Supported

Once the extraction is complete, data can be exported in three highly structured formats:

* 📊 **CSV (.csv):** Perfect for importing into Microsoft Excel, Google Sheets, or CRM systems for Lead Generation.
* 📜 **JSON (.json):** Ideal for developers to pipe data directly into external APIs, databases, or Node.js/Python backends.
* 📝 **TXT (.txt):** A clean, serialized plain-text format for quick human readability.

---

## 🛠️ Tech Stack & Architecture

Developed strictly following **Object-Oriented Programming (OOP)** principles:

* **Core Languages:** JavaScript (ES6+ Classes), HTML5, CSS3.
* **Framework Architecture:** Google Chrome Extension **Manifest V3** compliant.
* **State Management:** `chrome.storage.local` for robust offline database handling.
* **Design System:** Custom CSS Glassmorphism, SVG icons, and dynamic DOM manipulation.

---

## 🚀 Installation Guide

You can easily install this tool locally by downloading it directly from this repository:

1. **Download:** Navigate to the **[Releases](https://github.com/mmizan85/Search-Link-Extractor-Pro/releases)** section on the right side of this repository and download the latest `Search-Link-Extractor-Pro.zip` file.
2. **Extract:** Unzip the downloaded file to a folder on your computer.
3. **Load to Browser:**

* Open Google Chrome and go to `chrome://extensions/`.
* Enable **"Developer mode"** via the toggle switch in the top right corner.
* Click the **"Load unpacked"** button and select the extracted folder.

1. **Done:** Pin the extension to your toolbar and start extracting! 🎉

---

## 👨‍💻 Developer

Developed by **Mohammed Mizanur Rahman** — *Senior Software Engineer & Web Automation Expert*.

This tool was engineered to solve the complex challenges of web scraping, filtering, and data serialization in a fast, efficient, and beautifully designed package.

---

## 📄 License

This project is licensed under the **MIT License**.

You are free to use, modify, and distribute this software for personal or commercial projects. See the [LICENSE](LICENSE) file for more details.


