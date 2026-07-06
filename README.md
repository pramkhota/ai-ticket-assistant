#  AI Ticket Assistant & Logistics Platform


This project is an AI-powered assistant for the Customer Support team of a logistics company. It features a simulated Microservices architecture (Order, Delivery, Notification) communicating via RabbitMQ, with data storage backed by PostgreSQL and MongoDB.

### How AI is used in this project:
- **Gemini AI (LLM):** Used for natural language understanding to analyze customer support tickets, summarize the issue, determine the category, and formulate a suggested resolution.
- **RAG (Retrieval-Augmented Generation):** Used to retrieve the most relevant company policies from a MongoDB vector database to provide accurate, policy-backed resolutions.
- **AI Governance (PII Masking):** Implemented to scrub Personally Identifiable Information (like tracking numbers, phone numbers) from user input before sending it to the external AI model.


---

##  Prerequisites

Before running the project, ensure that the following foundational services are running locally on your machine:
1. **Node.js** (v18 or higher recommended)
2. **MongoDB** (running on port `27017`)
3. **PostgreSQL** (running on port `5432`)
4. **RabbitMQ** (running on port `5672` for message queuing)

---

##  Step-by-Step Setup Guide

### 1. Install Dependencies
Open your terminal in the project directory and run:
```bash
npm install
```

### 2. Environment Variables (.env)
The project requires environment variables to connect to APIs and databases. Ensure your `.env` file contains the following (create one if it doesn't exist):
```env
# Gemini AI (Used for analyzing support tickets)
GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE

# Database Connections
MONGODB_URI=mongodb://127.0.0.1:27017/ai-ticket-assistant
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/orders_db?schema=public"
```

### 3. Update Database Schema (Prisma)
Since we use PostgreSQL to store customers, orders, and event logs, we need to push the latest schema to the database:
```bash
npx prisma generate
npx prisma db push
```

### 4. Start the Web Server
Once everything is set up, run the following command to start the development server (uses `tsx` to run TypeScript files directly):
```bash
npm run dev
```

### 5. Testing the Application
Once the server displays ` Web Server is running!`, follow these steps:
1. Open your browser and navigate to: [http://localhost:3000](http://localhost:3000)
2. **AI Ticket Tab:** Simulate a customer complaint for the AI to analyze (the system will retrieve relevant internal policies to formulate a response).
3. **Create Order Tab:** Create a new parcel order to trigger the RabbitMQ event pipeline.
4. **Admin Dashboard Tab:** Monitor the real-time execution flow of microservices and check the history of sent emails (via Ethereal SMTP).

---

##  Important Project Structure
- `src/index.ts` - Main server entry point (API endpoints and static UI serving).
- `src/utils/pg.ts` & `src/utils/db.ts` - Database connection utilities.
- `src/utils/rabbitmq.ts` - Message broker connection and queue management.
- `src/gemini.ts` - Logic for invoking Google Gemini AI APIs.
- `src/utils/rag.ts` - Retrieval-Augmented Generation (RAG) for finding relevant policies.
- `public/index.html` - All frontend UI code (the 3-tab interface).
- `prisma/schema.prisma` - Database schema definitions (Customer, Order, OrderEventLog, EmailLog).
