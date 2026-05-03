# Quick Start Guide

## 🚀 Get Started in 2 Minutes

### Step 1: Install Frontend Dependencies
```bash
npm install
```

### Step 2: Start Backend (Terminal 1)
```bash
go run main.go
```

Wait for:
```
Server starting on :8080
```

### Step 3: Start Frontend (Terminal 2)
```bash
npm run dev
```

Wait for:
```
Local: http://localhost:3000
```

### Step 4: Open Browser
Navigate to: http://localhost:3000

## 📊 View API Documentation

Open in browser: `docs/swagger-ui.html` (requires backend running)

Or view JSON: http://localhost:8080/swagger.json

## 🐛 Troubleshooting

**Backend won't start?**
```bash
# Check if port 8080 is in use
lsof -ti:8080 | xargs kill -9
```

**Frontend won't start?**
```bash
# Clear cache and reinstall
rm -rf .next node_modules
npm install
```

---

For detailed documentation, see [README.md](README.md)
