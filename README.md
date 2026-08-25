# 🎬 Arabic Shorts Generator

<div align="center">

**AI-Powered Short Video Generator for Arabic Content Creators**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![Arabic](https://img.shields.io/badge/Language-Arabic-green.svg)](https://en.wikipedia.org/wiki/Arabic)

[Demo](#-demo) • [Features](#-features) • [Quick Start](#-quick-start) • [For Buyers](#-for-sale) • [Documentation](#-documentation)

</div>

---

## 📖 Table of Contents

- [About](#-about)
- [Features](#-features)
- [Demo](#-demo)
- [Tech Stack](#-tech-stack)
- [Quick Start](#-quick-start)
- [Deployment](#-deployment)
- [For Sale](#-for-sale) ⭐
- [Sponsor](#-sponsor) ⭐
- [Documentation](#-documentation)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🧐 About

Arabic Shorts Generator is a full-stack web application that automatically creates short-form Arabic videos (TikTok, YouTube Shorts, Instagram Reels) using AI. Perfect for content creators, marketers, and agencies targeting Arabic-speaking audiences.

### Why This Exists

Creating Arabic short-form video content is time-consuming. This tool automates:
- Script generation
- Text-to-speech (Arabic TTS)
- Video assembly
- Subtitle generation
- Export optimization

---

## ✨ Features

- 🇸🇦 **Arabic-First Design** - Built specifically for Arabic language with RTL support
- 🤖 **AI-Powered** - Integrates with leading AI services for TTS and video generation
- 🐳 **Docker-Ready** - One-command deployment with Docker Compose
- 📱 **Responsive UI** - Modern React frontend that works on all devices
- ⚡ **Fast Processing** - Queue-based video generation with progress tracking
- 🔒 **Secure** - Environment-based configuration, no hardcoded secrets
- 📊 **Production-Ready** - Includes deployment scripts and monitoring setup

---

## 🎥 Demo

> **📹 Video Demo Coming Soon**
>
> A 60-second demo video will be added here showing:
> - User interface walkthrough
> - Video generation process
> - Final output examples

**In the meantime:**
1. Clone the repo and run locally (see Quick Start)
2. Check the [screenshots](#-screenshots) below
3. [Contact us](#-contact) for a live demo call

---

## 🛠 Tech Stack

### Frontend
- **React.js** - Modern UI with hooks
- **Tailwind CSS** - Responsive design
- **React Router** - Client-side routing
- **Axios** - API communication

### Backend
- **Node.js** - Runtime environment
- **Express.js** - RESTful API
- **AI Integration** - TTS and video generation APIs
- **Queue System** - Background job processing

### Infrastructure
- **Docker** - Containerization
- **Docker Compose** - Multi-container orchestration
- **Bash Scripts** - Deployment automation
- **Environment Variables** - Configuration management

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/hadi-hani/arabic-shorts-generator.git
cd arabic-shorts-generator

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Run with Docker
docker-compose up --build

# Or run locally
npm run dev
```

### Usage

1. Open `http://localhost:3000`
2. Enter your Arabic script
3. Select voice and style options
4. Click "Generate Video"
5. Download your short video!

---

## 📦 Deployment

### One-Command Deploy

```bash
# Using the included deploy script
chmod +x deploy.sh
./deploy.sh
```

### Manual Deploy

```bash
# Build and push Docker images
docker-compose build
docker-compose push

# Deploy to your server
docker-compose up -d
```

### Supported Platforms

- ✅ **Self-Hosted** - Any VPS with Docker
- ✅ **Railway.app** - One-click deploy
- ✅ **Render.com** - Free tier available
- ✅ **AWS ECS** - Production scale
- ✅ **DigitalOcean App Platform** - Managed deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed guides.

---

## 💼 For Sale

<div align="center">

### 🚀 This Project Is Available For Acquisition!

**Own a complete, production-ready AI SaaS for the Arabic market**

[View Sale Details](./SELLING.md) • [Contact Developer](https://github.com/hadi-hani)

**Asking Price: $2,500 USD** (negotiable)

</div>

#### What You Get

✅ Complete source code ownership
✅ MIT license (unlimited use/resale)
✅ 30 days developer support
✅ Deployment assistance
✅ Marketing materials included

#### Business Opportunity

- 🇸🇦 Arabic content market: 50M+ creators
- 💰 Revenue potential: $5K-50K/month
- 🎯 Underserved niche with high demand
- 📈 AI video market growing 10x by 2030

**[Read full sale details →](./SELLING.md)**

---

## 💖 Sponsor

If you find this project useful, consider supporting its development:

[![GitHub Sponsors](https://img.shields.io/badge/GitHub_Sponsors-FF69B4?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/hadi-hani)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_A_Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/hadi-hani)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/hadi-hani)

Your support helps keep this project maintained and updated!

---

## 📚 Documentation

- **[SELLING.md](./SELLING.md)** - Complete sale information
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Deployment guides
- **[API.md](./API.md)** - API documentation
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - Contribution guidelines

---

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

**Commercial Use:** Yes! This project is available for acquisition. [See sale details →](./SELLING.md)

---

## 📞 Contact

- **GitHub:** [@hadi-hani](https://github.com/hadi-hani)
- **Email:** Available via GitHub profile
- **Demo Requests:** Open an issue or contact directly

---

<div align="center">

**Made with ❤️ for Arabic Content Creators**

[Star ⭐](https://github.com/hadi-hani/arabic-shorts-generator) this repo if you find it useful!

</div>