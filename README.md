# Retail Management System

A database-driven retail management application designed to simulate supermarket chain operations, including inventory management, state-specific product pricing, sales processing, payment validation, and reporting.

## Overview

The Retail Management System is a collaborative software project focused on designing and implementing a relational database and a web application for a multi-store supermarket chain.

The system models retail operations across multiple stores and states, supporting inventory tracking, product pricing, receipt generation, and payment processing. It also simulates checkout transactions, including bank balance validation and account balance updates for card payments.

## Planned Features

- **Multi-Store Management:** Maintain store information across multiple states.
- **Inventory Management:** Track product availability and aisle locations at individual stores.
- **State-Specific Pricing:** Maintain consistent product prices within each state while allowing prices to vary across states.
- **Sales Processing:** Generate receipts containing individual product lines, quantities or weights, unit prices, and totals.
- **Payment Processing:** Support cash and card payments, including simulated bank account balance validation and deductions.
- **Sales and Inventory Reporting:** Use SQL queries, joins, and aggregate functions to retrieve meaningful operational insights.
- **Checkout Simulation:** Automatically generate purchases using randomly selected products and process transactions.
- **Database Operations:** Create, populate, query, and inspect database tables through the application.

## Technology Stack

- **Database:** PostgreSQL
- **Backend:** JavaScript / Node.js
- **Frontend:** HTML, CSS, and JavaScript
- **Version Control:** Git and GitHub

*The technology stack and features will be updated as implementation progresses.*

## Database Design

The preliminary data model includes the following entities:

| Entity | Purpose |
|---|---|
| `Store` | Stores supermarket location and state information. |
| `Product` | Maintains product identifiers, names, categories, and tax treatment. |
| `Inventory` | Tracks products stocked at each store, quantities, and aisle locations. |
| `StateProductPrice` | Stores product prices by state. |
| `Receipt` | Records individual sales transactions. |
| `ReceiptItem` | Stores the products and quantities or weights associated with each receipt. |
| `BankAccount` | Maintains simulated bank account information and balances. |
| `Payment` | Records payment details and transaction status. |

The database uses primary keys, foreign keys, and relationship constraints to maintain data integrity and represent relationships between stores, products, inventory, sales, and payments.

## Transaction Processing

For card purchases, the system is designed to validate the available account balance before processing payment. Related database changes, including receipt creation, payment recording, and bank balance updates, will be handled within a database transaction to maintain consistency.

All account information and transactions used for testing are simulated. No real banking information is required.

## Front-end UI draft

The screens in this repo are a front-end-only draft. Double-click `home.html` to open it in Chrome, Firefox, or Safari. An internet connection is required so the Tailwind CSS file can load from the CDN. There is no build step and no server yet.

| File | Role |
|---|---|
| `home.html` | Layout: header, four sections, SQL log, toasts, confirmation modal |
| `js/api.js` | Mock backend. The only file to edit when the real server is ready. |
| `js/app.js` | Navigation, validation, and button wiring |
| `js/ui.js` | Tables, toasts, the confirmation modal, and the SQL log |

Every button that would talk to the database calls a function in `js/api.js`. Each stub returns `{ data, sql, ms }` after a short delay. The SQL text is shown in the panel labeled "SQL Sent to Server".

The header **Demo Video** link is a placeholder (`https://example.com/freshmart-team16-demo`). Replace that `href` in `home.html` when the video is published. The **README** link points at this file.

Bank accounts and payments in the draft are simulated.

## Getting Started

Setup instructions will be added as the application and database implementation are completed.

The completed setup guide will cover:

1. Cloning the repository.
2. Installing project dependencies.
3. Configuring the PostgreSQL database.
4. Creating and populating the database tables.
5. Starting the application.
6. Running checkout simulations and SQL reports.

## Project Status

**In Development**

The project is being developed in stages, beginning with database design and schema implementation, followed by data population, SQL queries, transaction logic, frontend integration, and testing.

## Contributors

Developed collaboratively as a team software and database engineering project.

## Disclaimer

This application is intended for educational and demonstration purposes. Bank accounts, payments, and financial transactions are simulated and are not connected to real financial institutions.
