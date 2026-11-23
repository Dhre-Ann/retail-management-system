# Retail Management System

**COSC 3380 | Group 16 | University of Houston**

A supermarket management web app built with PostgreSQL, Node.js, Express, HTML, and JavaScript. This Phase 2 submission includes checkout, reporting, database management, and concurrent checkout simulation.

## Running the Application

**Requirements:** Node.js, an SSH client, and access to the course PostgreSQL server.

1. From the project root, install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file in the project root:

   ```env
   DB_USER=dbs16
   DB_HOST=localhost
   DB_NAME=dbs16
   DB_PASSWORD=your_password
   DB_PORT=5433
   ```

3. Open a terminal and keep the SSH tunnel running:

   ```bash
   ssh -N -L 5433:localhost:5432 dbs16@52.22.24.16
   ```

4. In another terminal, start the API:

   ```bash
   cd server
   node index.js
   ```

5. Open `home.html` from the project root in your browser. If the database is empty, use **Admin → Create All Tables** and **Initialize Lookup Tables** before checkout. Simulation can also initialize missing tables and reference data automatically.

The API runs at `http://localhost:3000`. Keep the SSH tunnel and API terminal open while using the app.

## Features

- **Front Desk:** Process cash and card purchases, calculate totals and tax in PostgreSQL, update inventory, and save receipts. Failed card payments roll back without saving a sale.
- **Back Office:** View sales, inventory, tax, and recorded-payment reports; look up receipts; export results to CSV. Declined checkout attempts are not stored in the payments report.
- **Admin:** Create tables, load missing reference data, browse tables, and reset transaction data.
- **Simulation:** Run concurrent checkouts, view results and timing, and stop remaining checkouts. Missing tables and reference data are initialized automatically without resetting existing sales or balances.
- **SQL Panel:** View SQL sent to PostgreSQL, including checkout transactions.

## Database

The database uses two PostgreSQL schemas: `supermarkets` (stores, products, inventory, receipts, and payments) and `banking` (bank accounts).

- [`sql/schema.sql`](sql/schema.sql): Tables, constraints, and secondary indexes
- [`sql/seed.sql`](sql/seed.sql): Initial reference data
- [`sql/query.sql`](sql/query.sql): Report queries
- [`sql/transaction.sql`](sql/transaction.sql): Checkout transaction reference
- [Final ER diagram](docs/ERD/ERD_final.png) and [Phase 1 documentation](docs/Group_16_documentation_phase_1.pdf)

## Team Contributions

*Replace these placeholders with each member's actual work before submitting.*

- **[Member name]:** [Contributions]
- **[Member name]:** [Contributions]
- **[Member name]:** [Contributions]
- **[Member name]:** [Contributions]
