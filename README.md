# IVSERS Complete System

IVSERS is a fleet monitoring and safety platform for public transport operations. The project combines a Node.js backend, a static web dashboard, a MongoDB data store, MQTT-enabled vehicle telemetry ingestion, and ESP32/Arduino firmware for field devices.

## Architecture

- Backend API: `Backend/`
- Frontend dashboard: `Frontend/`
- Firmware: `Firmware/`
- Docker orchestration: `compose.yaml`

## Quick start with Docker

1. Copy the environment template:
   ```bash
   copy .env.example .env
   ```
2. Edit `.env` with real values before starting the stack.
3. Start the system:
   ```bash
   docker compose up --build -d
   ```
   On first startup, the backend creates the initial administrator from the
   `SUPER_ADMIN_*` values configured privately in `.env`. Do not commit or
   share this file.
4. Open the dashboard:
   - Frontend: http://localhost:8080
   - API health: http://localhost:3000/api/health

If you open the frontend with VS Code Live Server on port `5500`, it
automatically sends API and Socket.IO requests to the Docker frontend proxy on
port `8080`. The backend allows the localhost Live Server origins for this
development setup. For the simplest setup, open http://localhost:8080 directly.

## Demonstration simulation

Start the Docker stack using the instructions above, then open
http://localhost:8080/demo-login.html and select **Enter demo**. Demo access
does not require an email, password, or secret key. The separate demo console
always displays a **SIMULATED DATA** banner and shows eight simulated buses
across Lusaka, Ndola, Kitwe, Livingstone, Chipata, Solwezi, Kabwe, and Choma.
Select a map marker or fleet row to see its simulated vehicle ID, route, status,
GPS location, and sample readings. These vehicles and alerts are kept in
backend memory and are never written to the real fleet collections or
device-ingestion routes.

Select **Start simulation** for periodic generated location, speed, load, and
engine-temperature readings. The initial fleet includes normal operation, a
high-load warning, a high-temperature critical vehicle, an offline vehicle, and
an accident scenario. While the simulation is running, use the overload,
temperature, or accident buttons to trigger additional simulated alerts.
**Clear demo alerts** clears alerts and resets triggered warning scenarios;
**Stop simulation** pauses generated readings. Use **Exit demo** to return to
the real sign-in page. The simulated-persona selector previews role descriptions
only; it does not create or authenticate an account.

## Local backend development

1. Go to the backend folder:
   ```bash
   cd Backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a local `.env` file or use the root `.env` file.
4. Start the backend:
   ```bash
   npm run dev
   ```
5. Test the suite:
   ```bash
   npm test
   ```

## Required environment variables

The project expects these values in `.env`:

```env
JWT_SECRET=replace-with-a-long-random-secret
JWT_EXPIRES_IN=7d
BCRYPT_SALT_ROUNDS=12
DEVICE_API_KEY=replace-with-a-long-random-device-key
PORT=3000
MONGODB_URI=mongodb://localhost:27017/ivsers
CORS_ORIGIN=http://localhost:8080
FRONTEND_PORT=8080
MQTT_BROKER_URL=
MQTT_USERNAME=
MQTT_PASSWORD=
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=200
AUTH_RATE_LIMIT_MAX=10
```

For Docker Compose, the `compose.yaml` file reads the root `.env` values and passes them into the services.

## Create the first administrator account

The backend runs the bundled bootstrap script before starting, using the
`SUPER_ADMIN_*` values from the root `.env`. Provide a strong unique password
through your private environment configuration; no default login credentials
are shipped in the application. To run the bootstrap manually after the
database is running:

```bash
cd Backend
node scripts/seed-admin.js
```

The script reads `SUPER_ADMIN_NAME`, `SUPER_ADMIN_EMAIL`,
`SUPER_ADMIN_PASSWORD`, and optional `SUPER_ADMIN_PHONE` from the environment.
Set these values in `.env` or your deployment secret manager. Never paste
passwords or secret values into source code, documentation, or commits.

If the account already exists, the script exits without changing it.

## Roles, accounts, and vehicles

Sign in with the bootstrapped super administrator, then use **Staff &
Accounts** in the real dashboard to create named accounts with an organization,
role, phone number, email, and initial password. Super administrators can edit
account details and role, suspend/reactivate accounts, or delete accounts.
Deletion unlinks vehicle assignments and clears the account's alert-action
references while retaining the alerts. The backend only permits a
super administrator to manage accounts; account responses never include
password hashes. Give the initial password to its user through a secure
channel so they can sign in at `/login.html`.

Available roles and their scoped real-dashboard views:

- **Super administrator** — system-wide fleet, incident, and account management.
- **Fleet manager** — vehicle registration, assignments, and fleet operations
  within the manager's organization.
- **Driver** — only the vehicle assigned to the driver and its relevant alerts.
- **Bus owner** — only vehicles owned by that account and their relevant alerts.
- **Police, Hospital, RTSA, and Fire brigade** — organization-scoped incidents and
  limited vehicle/location information. These are dashboard roles only; IVSERS
  does not claim to integrate with external agency systems.

Use **Add Vehicle** on the real fleet dashboard as a super administrator or
fleet manager. Vehicles can be edited or deleted from the fleet table.
Deletion retires a vehicle from active listings while preserving its record
and historical alerts. Set a unique **Vehicle ID** that exactly matches the
`VEHICLE_ID` configured in `Firmware/Arduino_Mega_IVSERS/config.h` on the
vehicle. Enter the plate, make/model/year, passenger capacity, maximum load,
route, depot, and optional owner/driver assignments. A fleet manager's vehicle
is automatically assigned to that manager's organization; a super administrator
must specify the organization.

To try a role, create an account for it in **Staff & Accounts**, assign an
organization, and then sign in on a separate browser session with the account's
email and initial password. Create vehicles and assign their owners/drivers in
the same organization first to populate those role dashboards. The backend
enforces these scopes independently of the dashboard controls.

## Demo persona

The demo remains separate from real sign-in and real fleet records. The
simulated-persona selector is only a walkthrough aid and does not issue a
demo password or grant real permissions. Use real accounts created by an
administrator to test actual role authorization.

## Security notes

- Never commit `.env` files or device credentials.
- Use a real JWT secret in production.
- Protect MongoDB and MQTT broker credentials.
- Use HTTPS in production for the dashboard and API.
- The ESP32 bridge requires the `DEVICE_API_KEY` value to match the backend `DEVICE_API_KEY` environment variable.

## Project status

This repository is structured for a working fleet-safety deployment and includes the backend, frontend, firmware, and Docker orchestration. The remaining operational step is to provide real-world secrets and configure the production network environment.
