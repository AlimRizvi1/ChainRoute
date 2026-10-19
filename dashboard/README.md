# ChainRoute dashboard

The React dashboard calls the backend through `/api`. In Compose, Vite proxies that path to the `backend` service. When running Vite directly on Windows, set `VITE_API_TARGET=http://localhost:8080` in `dashboard/.env` if the backend is listening on the default local port.

To use the Phase 1 sample API, copy `.env.example` to `.env` and set `VITE_API_MODE=mock`. The login screen then offers all four synthetic demo roles; enter any non-empty password. Mock sessions and responses are local fixtures and never authenticate to the backend. Set `VITE_API_MODE=real` to use the configured backend again.

Run `npm ci`, `npm test`, and `npm run build` from this directory. The access token is held in tab-scoped `sessionStorage`, expires according to the server's `expiresIn`, and is cleared when the API returns `401`.

The login screen links to `/signup`. Public signup creates a Shipper; Carrier, Auditor, and Administrator accounts redeem an administrator-issued invitation. Invitation preview verifies the role before account creation and removes the secret from the URL. Signup checks password confirmation, supports password visibility, and signs in the new account using the backend's returned role and expiry. A username and password chosen here are independent of the local demo password.

Administrators use `/admin` to create 24-hour invitation links, revoke pending invitations, and enable or disable accounts. Invitation links appear once and are kept only in component memory. The backend enforces every operation independently of the route guard. Sample mode keeps real account creation and access changes disabled. Existing Yard Marks colors, typography, responsive layout, and reduced-motion rules are preserved; browser visual review still requires an available in-app browser connection.
