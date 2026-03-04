# Bitespeed Identity Reconciliation Service

A backend service that solves the identity reconciliation problem — linking multiple contact records belonging to the same person even when they use different email addresses or phone numbers across purchases.

Built as part of the [Bitespeed Backend Task](https://bitespeed.io).

## Tech Stack

- **Runtime:** Node.js with TypeScript
- **Framework:** Express
- **Database:** SQLite (via `sqlite3` + `sqlite`)
- **Validation:** Zod
- **Testing:** Jest + Supertest

## How It Works

The service maintains a `Contact` table where each customer can have multiple rows. Contacts are linked together:
- The **oldest** contact becomes the `primary`
- All others are marked as `secondary` and point to the primary via `linkedId`
- When a new request ties two previously unrelated primary contacts together, the **newer** one is automatically demoted to secondary

## API

### `POST /identify`

Accepts a JSON body with at least one of `email` or `phoneNumber`:

```json
{
  "email": "doc@hillvalley.edu",
  "phoneNumber": "88888"
}
```

Returns a consolidated view of all linked contacts:

```json
{
  "contact": {
    "primaryContatctId": 1,
    "emails": ["doc@hillvalley.edu", "emmett@hillvalley.edu"],
    "phoneNumbers": ["88888"],
    "secondaryContactIds": [5]
  }
}
```

- The primary contact's email and phone are always listed **first** in their respective arrays.
- Sends `400` if neither `email` nor `phoneNumber` is provided.

### `GET /health`

Returns `{ "status": "ok" }` — useful for uptime monitoring.

## Getting Started

### Prerequisites

- Node.js ≥ 18
- npm

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file in the project root:

```env
DATABASE_URL="file:./dev.db"
PORT=3000
```

### Run Locally

```bash
npm run dev
```

The server starts at `http://localhost:3000`.

### Build for Production

```bash
npm run build
npm start
```

## Running Tests

```bash
npm test
```

Tests use an isolated `test.db` database so they don't interfere with development data.

## Project Structure

```
src/
├── app.ts                    # Express app setup & middleware
├── index.ts                  # Server bootstrap & graceful shutdown
├── database/
│   └── connection.ts         # SQLite connection & schema initialization
├── models/
│   └── types.ts              # TypeScript interfaces
├── routes/
│   └── contactRoutes.ts      # POST /identify route with Zod validation
└── services/
    └── reconciler.ts         # Core reconciliation logic
tests/
├── reconciliation.test.ts    # Integration tests
└── setup.ts                  # Test environment config
```

## Author

**Yash Dhiman** — [@theyashdhiman04](https://github.com/theyashdhiman04)
