# Project Context: AccessKE (Dumu Technologies)

## 1. High-Level Objective
To engineer **AccessKE**, a WhatsApp-based event ticketing concierge for the Kenyan market.
- **Mission:** Maximize "in-chat" completion rates. Users should only leave WhatsApp if absolutely necessary (i.e., Card payments).
- **Core Challenge:** Managing a hybrid payment flow that prioritizes User Experience (UX) without sacrificing reliability.

## 2. Architectural Decision Record (ADR)

### A. WhatsApp Interface Strategy
**Decision:** WhatsApp Cloud API (Official Meta).
- **Reasoning:** Stability is paramount for ticketing events (burst traffic).

### B. Payment Orchestration (The "Channel-Based" Split)
**Decision:** Route by *Method*, not by *User Identity*.

**Route 1: M-Pesa (All Variants) -> IntaSend**
- **Logic:** IntaSend's STK Push is the lowest-friction payment method.
- **Flow:**
    1. Bot asks user if they want to use their current WhatsApp number.
    2. If **YES**: Trigger STK to that number.
    3. If **NO**: Bot prompts for the alternate number in-chat, then triggers STK to that alternate number.
- **Benefit:** Keeps the user inside WhatsApp for 90% of transactions.

**Route 2: Card Payments -> PesaPal**
- **Logic:** Card payments require PCI-compliant input fields (CVV, Expiry), which we cannot securely collect inside a WhatsApp chat.
- **Flow:** Generate a PesaPal Order Link and redirect the user to the browser.

### C. Concurrency & Inventory Locking
**Decision:** Redis-based "Reservation Pattern".
- **Mechanism:** Set a Redis key `lock:event:{id}:ticket:{tier}` with a **10-minute TTL**.
- **Reasoning:** The 10-minute window accommodates the slower PesaPal web-redirect flow for card users.

## 3. Tech Stack
- **Runtime:** Node.js (TypeScript).
- **Database:** PostgreSQL (Supabase).
- **Cache:** Redis.
- **Payment SDKs:**
    - `intasend-node` (for M-Pesa STK).
    - Custom Axios wrapper for PesaPal v3 APIs (for Link generation).

## 4. Domain Logic & Business Rules

### Phone Number Normalization
- **Critical Rule:** All inputs (whether from WhatsApp metadata or user text entry) must be normalized to `254xxxxxxxxx` before hitting the IntaSend API.
- **Validation:** If a user types a "friend's number" for payment, validate it strictly (Regex: `^(?:254|\+254|0)?([17](?:(?:[0-9][0-9])|(?:0[0-8])|(?:4[0-8]))[0-9]{6})$`) before attempting the API call to save costs/errors.

### The "Double-Dip" Prevention
- If a user starts an M-Pesa payment (IntaSend) but then clicks the Card link (PesaPal), we technically have two potential payments for one seat.
- **Rule:** The first *Webhook* (SUCCESS) to arrive wins. The database must lock the Booking row `FOR UPDATE` upon receiving a webhook to ensure we don't mark it Paid twice.

## 5. Coding Standards for AI
- **Separation:** Keep `IntaSendService.ts` and `PesaPalService.ts` completely decoupled. They should share a common interface `IPaymentProvider` with a method `initiateTransaction()`.
- **User Prompts:** When asking for a "different number," ensure the bot explicitly says: *"Please reply with the M-Pesa number in the format 07XX..."* to reduce validation errors.