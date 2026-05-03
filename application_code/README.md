# SDET Test - Payment Checkout Application

A full-stack application demonstrating a payment checkout system with **soft-fail error handling**. The backend is built with Golang and includes Swagger documentation, while the frontend is built with Next.js.

## 🎯 Key Features

- **Golang Backend** with 3 API endpoints
- **Swagger API Documentation** 
- **Next.js Frontend** with TypeScript
- **Mock Payment Processing**

## 🏗️ Architecture

### Backend (Golang)
- **Port**: 8080
- **Framework**: Native Go `net/http`
- **4 API Endpoints**:
  1. `GET /api/health` - Health check
  2. `POST /api/checkout` - Process payment
  3. `POST /api/validate-email` - Email validation
  4. `POST /api/validate-card` - Card validation using Luhn algorithm

### Frontend (Next.js)
- **Port**: 3000
- **Framework**: Next.js 16 with TypeScript
- **Features**: 
  - Real-time XHR/async validation for email and card number
  - Soft-fail handling for email validation
  - Visual feedback with validation indicators
  - Form validation and health check

## 📋 Prerequisites

- **Go**: Version 1.21 or higher
- **Node.js**: Version 18 or higher
- **npm**: Version 9 or higher

## 🚀 How to Run

### Option 1: Run Both Services Separately

#### 1. Start the Backend (Terminal 1)

```bash
go run main.go
```

You should see:
```
========================================
Server starting on :8080
API Endpoints:
  GET  /api/health         - Health check
  POST /api/checkout       - Process payment
  POST /api/validate-email - Validate email
Swagger Docs:
  GET  /swagger.json       - API specification
========================================
```

#### 2. Start the Frontend (Terminal 2)

```bash

npm install  # Only needed first time
npm run dev
```

You should see:
```
  ▲ Next.js 16.x.x
  - Local:        http://localhost:3000
```

#### 3. Access the Application

- **Frontend**: http://localhost:3000
- **Swagger API Docs**: http://localhost:8080/swagger.json
- **Health Check**: http://localhost:8080/api/health

### Option 2: Run with Background Process

```bash
# Terminal 1 - Start backend in background
go run main.go &

# Terminal 1 - Start frontend
npm run dev
```

## 📖 Swagger Documentation

Access the Swagger specification at: http://localhost:8080/swagger.json

You can view it in tools like:
- [Swagger Editor](https://editor.swagger.io/) - Paste the JSON content
- [Swagger UI](https://petstore.swagger.io/) - Enter: `http://localhost:8080/swagger.json`

## 🗂️ Project Structure

```
application/
├── main.go                 # Golang backend server
├── go.mod                  # Go module definition
├── docs/
│   └── swagger.json        # Swagger API specification
├── app/
│   ├── layout.tsx          # Next.js root layout
│   └── page.tsx            # Main checkout page
└── package.json            # Node.js dependencies
```

## 🛠️ Troubleshooting

### Backend Issues

**Problem**: `port 8080 already in use`
```bash
# Find and kill the process
lsof -ti:8080 | xargs kill -9
```

**Problem**: `go: cannot find main module`
```bash
# Initialize Go module
go mod init github.com/paymongo/sdet-test
```

### Frontend Issues

**Problem**: `command not found: next`
```bash
# Install dependencies
npm install
```

**Problem**: `Port 3000 is already in use`
```bash
# Use a different port
npm run dev -- -p 3001
```

**Problem**: `Cannot connect to backend`
- Ensure backend is running on port 8080
- Check CORS is enabled in backend
- Verify no firewall blocking localhost
