# Proctoring-app
Focus &amp; Object Detection in Video Interviews is a web-based proctoring system using TensorFlow.js for real-time monitoring. It detects focus loss, multiple/absent faces, and suspicious objects (phone, books). Events are logged with timestamps, and reports (CSV/PDF) with integrity scores are generated for fair online assessments.


The system logs all events with timestamps and generates a **Proctoring Report** (CSV/PDF) with an **Integrity Score**.  

---

## ✨ Features  
- 🎥 Candidate video recording & playback  
- 👀 Focus detection:  
  - Not looking at screen > 5 sec  
  - Face absent > 10 sec  
  - Multiple faces detected  
- 📱 Suspicious item detection:  
  - Mobile phones  
  - Books/Notes  
  - Extra electronic devices  
- 📑 Reporting:  
  - Candidate Name & Duration  
  - Focus lost count  
  - Suspicious events  
  - Integrity Score (100 – deductions)  
  - Export as **CSV/PDF**  
- 🗄️ Optional Backend (Node.js + MongoDB) for logs storage  

---

## 🛠️ Tech Stack  
- **Frontend**: HTML, CSS, JavaScript, TensorFlow.js, Coco-SSD, Face Landmarks Detection  
- **Backend (Optional)**: Node.js, Express.js, MongoDB  
- **Reporting**: jsPDF (PDF), Blob API (CSV)  

---

## 🚀 Getting Started  

### 1️⃣ Clone Repository  
```bash
git clone https://github.com/your-username/focus-object-detection.git
cd focus-object-detection
2️⃣ Setup Frontend
bash
Copy code
cd frontend
npm install
npm start
👉 App will open on http://127.0.0.1:3000

3️⃣ Setup Backend (Optional)
bash
Copy code
cd backend
npm install
npm start
👉 Runs on http://localhost:4000

⚠️ Make sure MongoDB is running locally, or update .env with your connection string.
