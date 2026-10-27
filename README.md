# Retail Management System

**COSC 3380 | Group 16 | University of Houston**

A supermarket management web application built with PostgreSQL, Node.js, Express, and JavaScript.

## Features

- Manage inventory across 100 stores in 10 states.
- Process cash and card purchases, including inventory updates and simulated bank transactions.
- Generate receipts with itemized purchases, taxes, and totals.
- Simulate multiple checkout transactions with configurable stores and concurrent connections.
- Run SQL reports for sales, inventory, taxes, and payments.
- Create, initialize, browse, and delete database records through the Admin interface.

## Database Design

The database contains eight tables: `StateTax`, `Store`, `Product`, `Inventory`, `Receipt`, `ReceiptItem`, `Payment`, and `BankAccount`.

The schema uses primary keys, foreign keys, and PostgreSQL transactions to maintain data integrity.

**Documentation and SQL files:**

- [Database Design and ER Diagram](docs/Group_16_documentation_phase_1.pdf)
- [Database Schema](sql/schema.sql)
- [Seed Data](sql/seed.sql)
- [SQL Queries](sql/query.sql)
- [Transaction SQL](sql/transaction.sql)

## Running the Application

The database is the course PostgreSQL server. The app does not connect to it directly. An SSH tunnel forwards local port `5433` to PostgreSQL on the remote host, and `.env` points Node at that local port. The Express server only serves the API. The interface is `home.html` in the project root, opened as a file in the browser. That page calls `http://localhost:3000`.

You need Node.js and an SSH client. Windows Command Prompt already includes `ssh`.

### First-time setup

From the project root:

```bat
npm install
```

Create a `.env` file in the project root (it is gitignored). Use the course database password for `DB_PASSWORD`:

```
DB_USER=dbs16
DB_HOST=localhost
DB_NAME=dbs16
DB_PASSWORD=your_course_password
DB_PORT=5433
```

`DB_HOST` and `DB_PORT` must stay `localhost` and `5433`. Those values match the tunnel below, not the remote server's own port.

### Each time you run it

Use two Command Prompt windows. Leave both open while you use the app.

**1. Start the database tunnel**

```bat
ssh -N -L 5433:localhost:5432 dbs16@52.22.24.16
```

When SSH asks for a password, enter the same password as `DB_PASSWORD` in `.env`. `-N` keeps the window on the tunnel only; there is no remote shell. The window looks idle when the tunnel is up. Closing it drops the database connection.

**2. Start the API**

In a second window, from the `server` folder:

```bat
cd server
node index.js
```

Wait until the console prints `Server is running on port 3000`. There is no `npm start` script.

**3. Open the interface**

Open `home.html` from the project root in a browser (double-click the file, or drag it into the browser). The page needs internet access so Tailwind and the fonts can load from their CDNs.

`http://localhost:3000` is the API, not the page. A request to `/api/health` there should return a successful database connection if the tunnel and server are both running.

The first time the database is empty, use **Admin / Database Tools** in the page to create and initialize the tables.

## Project Status

**Phase 1 complete.** Database design, checkout processing, simulation, reporting, and Admin operations are implemented.
