# Shopping Microservices

A production-ready e-commerce backend built with a microservices architecture using Node.js, MongoDB, RabbitMQ, and Docker.

---

## Architecture Overview

```
                          ┌─────────────────────┐
                          │    Nginx Proxy       │
                          │     (Port 80)        │
                          └────────┬────────────┘
                                   │
                          ┌────────▼────────────┐
                          │    API Gateway       │
                          │     (Port 8000)      │
                          └──┬──────┬──────┬────┘
                             │      │      │
               ┌─────────────▼──┐ ┌─▼───────────┐ ┌────▼─────────────┐
               │ Customer Service│ │Products Svc │ │ Shopping Service │
               │   (Port 8001)  │ │ (Port 8002) │ │   (Port 8003)    │
               └────────┬───────┘ └──────┬──────┘ └────────┬─────────┘
                        │                │                   │
                        └────────────────┼───────────────────┘
                                         │
                          ┌──────────────▼──────────────┐
                          │          MongoDB             │
                          │         (Port 27017)         │
                          └─────────────────────────────┘

                ┌───────────────────────────────────────────┐
                │              RabbitMQ                     │
                │   Exchange: ONLINE_SHOPPING (direct)      │
                │   Products → Customer Queue               │
                │   Products → Shopping Queue               │
                │   Shopping → Customer Queue               │
                └───────────────────────────────────────────┘
```

---

## Services

### 1. Customer Service — Port `8001`

Handles user registration, authentication, profile management, and maintains the user's cart, wishlist, and order history.

| Method | Endpoint           | Auth | Description                  |
| ------ | ------------------ | ---- | ---------------------------- |
| `POST` | `/signup`          | No   | Register new user            |
| `POST` | `/login`           | No   | Authenticate and receive JWT |
| `POST` | `/address`         | Yes  | Add a delivery address       |
| `GET`  | `/profile`         | Yes  | Retrieve user profile        |
| `GET`  | `/shoping-details` | Yes  | Get shopping history         |
| `GET`  | `/wishlist`        | Yes  | Retrieve wishlist            |

---

### 2. Products Service — Port `8002`

Manages the product catalog, categories, and triggers cart/wishlist events via RabbitMQ.

| Method   | Endpoint          | Auth | Description                       |
| -------- | ----------------- | ---- | --------------------------------- |
| `POST`   | `/product/create` | No   | Create a new product              |
| `GET`    | `/`               | No   | List all products with categories |
| `GET`    | `/category/:type` | No   | Filter products by category       |
| `GET`    | `/:id`            | No   | Get a single product by ID        |
| `POST`   | `/ids`            | No   | Get multiple products by IDs      |
| `PUT`    | `/wishlist`       | Yes  | Add product to wishlist           |
| `DELETE` | `/wishlist/:id`   | Yes  | Remove product from wishlist      |
| `PUT`    | `/cart`           | Yes  | Add item to cart                  |
| `DELETE` | `/cart/:id`       | Yes  | Remove item from cart             |

---

### 3. Shopping Service — Port `8003`

Manages the shopping cart and order processing.

| Method | Endpoint  | Auth | Description       |
| ------ | --------- | ---- | ----------------- |
| `GET`  | `/cart`   | Yes  | Get current cart  |
| `POST` | `/order`  | Yes  | Place an order    |
| `GET`  | `/orders` | Yes  | Get order history |

---

### 4. API Gateway — Port `8000`

Express-based reverse proxy that routes incoming requests to the appropriate downstream service.

| Path Pattern  | Routes To                  |
| ------------- | -------------------------- |
| `/customer/*` | Customer Service (`:8001`) |
| `/shopping/*` | Shopping Service (`:8003`) |
| `/*`          | Products Service (`:8002`) |

---

### 5. Nginx Proxy — Port `80`

Production reverse proxy with load balancing support. Sits in front of all services.

| Path        | Upstream         |
| ----------- | ---------------- |
| `/`         | Products Service |
| `/shopping` | Shopping Service |
| `/customer` | Customer Service |

Config: 4 worker processes, 1024 connections per worker, HTTP/1.1 with WebSocket upgrade support.

---

## Asynchronous Messaging — RabbitMQ

Services communicate asynchronously using RabbitMQ with a **direct exchange** named `ONLINE_SHOPPING`.

### Queues & Binding Keys

| Queue          | Binding Key        |
| -------------- | ------------------ |
| Customer Queue | `CUSTOMER_SERVICE` |
| Shopping Queue | `SHOPPING_SERVICE` |

### Event Flow

```
Products Service
  ├─ PUT /wishlist       → publishes ADD_TO_WISHLIST    → Customer Queue
  ├─ DELETE /wishlist/:id→ publishes REMOVE_FROM_WISHLIST → Customer Queue
  ├─ PUT /cart           → publishes ADD_TO_CART        → Customer Queue + Shopping Queue
  └─ DELETE /cart/:id    → publishes REMOVE_FROM_CART   → Customer Queue + Shopping Queue

Shopping Service
  └─ POST /order         → publishes CREATE_ORDER       → Customer Queue
```

### Message Payload

```json
{
  "event": "ADD_TO_CART",
  "data": {
    "userId": "<customer_id>",
    "product": { "<product_object>" },
    "qty": 2,
    "order": { "<order_object>" }
  }
}
```

### Event Handlers

| Event                  | Handled By       | Action                                     |
| ---------------------- | ---------------- | ------------------------------------------ |
| `ADD_TO_WISHLIST`      | Customer Service | Adds product to customer's wishlist        |
| `REMOVE_FROM_WISHLIST` | Customer Service | Removes product from wishlist              |
| `ADD_TO_CART`          | Customer Service | Adds item to customer's embedded cart      |
| `ADD_TO_CART`          | Shopping Service | Updates Cart document                      |
| `REMOVE_FROM_CART`     | Customer Service | Removes item from customer's embedded cart |
| `REMOVE_FROM_CART`     | Shopping Service | Updates Cart document                      |
| `CREATE_ORDER`         | Customer Service | Appends order to customer's orders array   |

---

### End-to-End Communication Examples

#### Example 1 — User adds a product to their cart

```
Client
  │
  │  PUT /cart   { productId, qty }   (with JWT)
  ▼
API Gateway (8000)
  │
  │  forwards to /cart
  ▼
Products Service (8002)
  │  1. Validates JWT
  │  2. Fetches product from MongoDB
  │  3. Publishes two RabbitMQ messages to exchange ONLINE_SHOPPING:
  │
  │     Message A ──► routing key: CUSTOMER_SERVICE
  │     {
  │       "event": "ADD_TO_CART",
  │       "data": { "userId": "abc123", "product": {...}, "qty": 2 }
  │     }
  │
  │     Message B ──► routing key: SHOPPING_SERVICE
  │     {
  │       "event": "ADD_TO_CART",
  │       "data": { "userId": "abc123", "product": {...}, "qty": 2 }
  │     }
  │
  ▼  Returns updated wishlist/cart to client

RabbitMQ Exchange: ONLINE_SHOPPING
  ├──► Customer Queue  (binding key: CUSTOMER_SERVICE)
  │       └─ Customer Service consumes message
  │            → Finds customer by userId
  │            → Pushes product+qty into customer.cart[]
  │            → Saves to MongoDB
  │
  └──► Shopping Queue  (binding key: SHOPPING_SERVICE)
          └─ Shopping Service consumes message
               → Finds or creates Cart document for userId
               → Upserts item in cart.items[]
               → Saves to MongoDB
```

---

#### Example 2 — User places an order

```
Client
  │
  │  POST /order   { txnId }   (with JWT)
  ▼
API Gateway (8000)
  │
  │  forwards to /order
  ▼
Shopping Service (8003)
  │  1. Validates JWT
  │  2. Reads current Cart from MongoDB for this user
  │  3. Calculates total amount
  │  4. Creates an Order document in MongoDB
  │  5. Publishes one RabbitMQ message:
  │
  │     Message ──► routing key: CUSTOMER_SERVICE
  │     {
  │       "event": "CREATE_ORDER",
  │       "data": {
  │         "userId": "abc123",
  │         "order": {
  │           "orderId": "uuid-xxxx",
  │           "amount": 49.99,
  │           "status": "received",
  │           "txnId": "txn-yyyy",
  │           "items": [...]
  │         }
  │       }
  │     }
  │
  ▼  Returns order details to client

RabbitMQ Exchange: ONLINE_SHOPPING
  └──► Customer Queue  (binding key: CUSTOMER_SERVICE)
          └─ Customer Service consumes message
               → Finds customer by userId
               → Appends order to customer.orders[]
               → Saves to MongoDB
```

---

#### Example 3 — User removes a product from their wishlist

```
Client
  │
  │  DELETE /wishlist/:productId   (with JWT)
  ▼
API Gateway (8000)
  │
  │  forwards to /wishlist/:productId
  ▼
Products Service (8002)
  │  1. Validates JWT
  │  2. Publishes one RabbitMQ message:
  │
  │     Message ──► routing key: CUSTOMER_SERVICE
  │     {
  │       "event": "REMOVE_FROM_WISHLIST",
  │       "data": { "userId": "abc123", "product": { "_id": "productId" } }
  │     }
  │
  ▼  Returns updated wishlist to client

RabbitMQ Exchange: ONLINE_SHOPPING
  └──► Customer Queue  (binding key: CUSTOMER_SERVICE)
          └─ Customer Service consumes message
               → Finds customer by userId
               → Filters out product from customer.wishlist[]
               → Saves to MongoDB
```

---

## Database — MongoDB

All services connect to a shared MongoDB instance via Mongoose.

### Models

#### Customer

```
email, password (hashed), salt, phone,
address[]  → ref: Address
cart[]     → embedded cart items
wishlist[] → embedded product items
orders[]   → embedded order references
```

#### Address

```
street, postalCode, city, country
```

#### Product

```
name, desc, banner (image URL), type (category),
unit (stock), price, available (boolean), suplier
```

#### Cart

```
customerId, items[{ product, unit }]
```

#### Order

```
orderId (UUID), customerId, amount (total),
status, txnId (transaction ID), items[]
```

---

## Authentication

JWT-based authentication using `jsonwebtoken`.

- **Secret**: `APP_SECRET` environment variable
- **Expiry**: 30 days
- **Payload**: `{ email, _id }`

### Signup Flow

1. Generate salt via `bcrypt`
2. Hash password with salt
3. Save customer to MongoDB
4. Return `{ id, token }`

### Login Flow

1. Lookup customer by email
2. Validate password with `bcrypt`
3. Return `{ id, token }`

### Middleware (`UserAuth`)

Reads the `Authorization: Bearer <token>` header, verifies the JWT, and attaches the user to `req.user`. Returns `403` if invalid.

---

## Tech Stack

| Layer            | Technology              |
| ---------------- | ----------------------- |
| Runtime          | Node.js                 |
| Web Framework    | Express.js              |
| Database         | MongoDB + Mongoose      |
| Message Broker   | RabbitMQ (amqplib)      |
| Authentication   | JWT + bcrypt            |
| Reverse Proxy    | Nginx                   |
| API Gateway      | express-http-proxy      |
| Containerization | Docker + Docker Compose |

---

## Project Structure

```
shopping_ms/
├── docker-compose.yml
├── customer/               # Customer microservice
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── api/            # Route handlers & middleware
│       ├── config/         # Environment config
│       ├── database/       # Mongoose models & repositories
│       ├── services/       # Business logic
│       └── utils/          # Error handling utilities
├── products/               # Products microservice
│   └── src/ ...
├── shopping/               # Shopping/orders microservice
│   └── src/ ...
├── gateway/                # API Gateway
│   └── index.js
└── proxy/                  # Nginx reverse proxy
    ├── Dockerfile
    └── nginx.conf
```

---

## Running with Docker

### Prerequisites

- Docker
- Docker Compose

### Start All Services

```bash
docker-compose up --build
```

This starts:

- MongoDB on port `27017`
- Customer Service on port `8001`
- Products Service on port `8002`
- Shopping Service on port `8003`
- Nginx Proxy on port `80`

### Environment Variables

Each service reads from environment variables. Key variables:

| Variable             | Description                                       |
| -------------------- | ------------------------------------------------- |
| `MONGODB_URI`        | MongoDB connection string                         |
| `APP_SECRET`         | JWT signing secret                                |
| `MESSAGE_BROKER_URL` | RabbitMQ connection URL (e.g. `amqp://localhost`) |
| `PORT`               | Service port                                      |

---

## Running Locally (Without Docker)

```bash
# Install dependencies for each service
cd customer && npm install
cd ../products && npm install
cd ../shopping && npm install
cd ../gateway && npm install

# Start each service (requires MongoDB and RabbitMQ running locally)
cd customer && npm start
cd products && npm start
cd shopping && npm start
cd gateway && npm start
```

Each service uses `nodemon` for auto-reloading in development.
