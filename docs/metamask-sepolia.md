# ChainRoute MetaMask DApp

## Implemented and still requiring a wallet signature

The dashboard has a **Wallet & freight** workspace at `/wallet`. The default DApp network is Ethereum Sepolia, chain ID **11155111**. The existing local Anvil demonstration and its agreements remain available under Blockchain and Contracts. They are separate ledgers, and historical local transactions do not become Sepolia transactions.

Implemented: MetaMask connection/network switching, signed wallet ownership verification, administrator deployment through MetaMask, exact deployed-bytecode/operator verification, wallet-signed freight initiation, atomic ERC-721 receipt minting, booking/shipment/delivery/dispute/settlement/closure signing, transaction recovery, receipt verification, actual timestamps/gas costs, and Sepolia Etherscan links. The API requires two block confirmations for Sepolia before marking a transaction confirmed. This is an application confirmation policy, not a claim of consensus finality.

**Live activation remains pending until the wallet owner connects and approves the deployment.** A public wallet address cannot sign transactions. No user seed phrase or private key is required by the server, and none should be shared. Local automated tests do not count as a live Sepolia deployment or a real MetaMask approval.

## First run

1. Open `http://localhost:5173/login` in Chrome, Edge or Firefox with MetaMask installed. The Codex in-app preview may not expose browser wallet extensions.
2. Sign in as an Administrator, then open **Wallet & freight**. Use the administrator account for the first demonstration if the same wallet will deploy and initiate freight. Each application account can have one verified wallet, and one wallet cannot impersonate multiple application accounts.
3. Select the intended MetaMask account, connect, switch to Sepolia, and sign the free ownership message. The supplied public address is `0x2300d71cB0D5d0b7C6C9eBd4a0beD73218cFEBD5`. It is not automatically linked without its owner's signature.
4. Click **Deploy with MetaMask**, review the gas estimate, and approve. This creates `ChainRouteFreightDApp`; the deployer becomes its immutable operator. Click **Check transaction receipt** until confirmed. The application verifies the runtime bytecode against the compiled build before registering the address.
5. Create freight orders with future delivery deadlines and run an allocation from that same account. Existing local agreements cannot be converted to testnet transactions. Choose **Initiate on Sepolia with MetaMask** on a fresh saved plan.
6. Enter a different carrier wallet and commercial terms. Its owner should link that wallet to a Carrier account to use carrier actions. Plan wagon count/deadline are derived by the API. The terms hash commits to the shipper, carrier, terms, and full saved allocation.
7. Choose **Initiate freight & mint receipt** and approve the transaction in MetaMask. Check its receipt. The agreement and one `CRFR` token are created atomically, or the transaction reverts.
8. Open **View transaction** for the transaction hash, sender, gas, block, time and logs. A successful initiation emits `AgreementCreated`, ERC-721 `Transfer` from the zero address, and `FreightInitiated`.
9. To display the NFT in a wallet that supports manual import, use the deployed contract address and displayed token ID. A successful mint does not guarantee automatic wallet-gallery discovery. `tokenURI` returns self-contained on-chain JSON metadata.
10. Sign in as the carrier with its own connected wallet for booking, dispatch/checkpoint/arrival and delivery. The original operator wallet, linked to an Administrator account, signs settlement recording, dispute decisions, and closure.

The transaction hash is persisted in browser recovery storage immediately after MetaMask returns it. The server saves verified initiation/action transaction records in PostgreSQL. Refreshing a receipt never sends another transaction. User rejection before broadcasting creates no on-chain transaction. A mined reverted transaction can still charge gas. Wallet speed-up/replacement and dropped-transaction recovery are not automatically reconciled; inspect MetaMask/explorer before resubmitting. Prepared terms cannot silently change on retry; use a new allocation if the agreed terms need to change.

## Which tokens and payments exist?

`ChainRouteFreightDApp` inherits the tested settlement state machine and OpenZeppelin's ERC-721 implementation. Each successful `initiateFreight` call mints **one non-fungible ChainRoute Freight Receipt**, symbol **CRFR**, to the transaction sender. The token ID equals the agreement ID. It identifies an agreement; it is not ETH, a fungible ERC-20 currency, a payment token, a financial claim, or legal title to the cargo. Transferring the receipt does not change the original shipper, carrier or operator permissions.

Sepolia ETH already exists as the network's native gas asset. Our contract cannot mint Sepolia ETH. Obtain test ETH from a faucet if needed. Freight values, deductions and net settlement stay integer **INR paise accounting amounts**. The DApp initiation is non-payable and sends `value = 0`: it takes **gas only**, with no freight principal, platform fee or escrow deposit. Payment release records the calculated amount; it does not move ETH, ERC-20 tokens or bank money.

| Action | Wallet charged network gas |
|---|---|
| Deploy contract | Administrator/operator deploying wallet |
| Initiate freight and mint its receipt | Connected shipper/plan owner's wallet |
| Confirm booking, shipment milestone, delivery | Assigned carrier wallet |
| Raise dispute | Shipper or carrier submitting the dispute |
| Resolve dispute, record settlement, close agreement | Original operator wallet |
| Connect/sign ownership message, read records, run AI | No blockchain gas |

On a real public Ethereum deployment, the same signing accounts pay real ETH gas unless a separate relayer/paymaster arrangement is implemented. The network base fee is burned and the priority fee goes to the block proposer; these gas costs are not freight revenue for ChainRoute. Actual freight payment would need a separately specified and funded escrow or payment integration: normally the shipper funds it and the carrier receives the agreed net amount. Tokens are deducted from an ERC-20 account only after its approval/permit and a contract transfer, or native ETH when explicitly sent with the transaction. None of those commercial transfers is implemented here.

## Blockchain type and consensus

| Environment | Classification | Consensus |
|---|---|---|
| Existing Anvil demo, chain 31337 | Single-node local development chain; privately operated, not a consortium network | Automatic/manual development mining. It does not demonstrate distributed PoW, PoS or PBFT consensus. |
| MetaMask DApp on Sepolia | Publicly accessible Ethereum testnet, with publicly readable transactions/state. Sepolia has a permissioned validator set; that does not make ChainRoute a multi-company consortium deployment. | Ethereum proof of stake. ChainRoute uses the network's consensus; it does not run a new consensus algorithm. |
| Hypothetical real Ethereum deployment | Public blockchain application | Ethereum proof of stake, real ETH gas. |

Ethereum consensus uses validators to propose/attest blocks. Its Gasper protocol combines LMD-GHOST fork choice with Casper-FFG checkpoint finality. ChainRoute's Solidity state machine executes in the EVM and is not itself a consensus mechanism. Application roles do not make public on-chain data private. A consortium implementation would need an intentionally configured network governed by participating organizations; none is configured in this repository.

## Other mechanisms and trust boundaries

- **Wallet authentication:** a five-minute, single-use challenge binds an EOA wallet to the authenticated application account, origin text, chain ID and nonce. Account/role authorization still uses the existing API session. Linking does not grant a different role or unlimited spending approval.
- **Transaction authorization:** MetaMask retains the user's private key and signs EVM transactions. Sender checks, chain ID, transaction nonce, and contract access/state checks apply. No user private key is sent to PostgreSQL or the backend.
- **Integrity:** Keccak-256 commits the freight terms and allocation; block parent hashes and Ethereum's authenticated data structures make ledger changes detectable. Hashes are commitments, not encryption. Public contract commercial terms remain public.
- **Execution:** the EVM executes deterministic Solidity code. Atomic mint/agreement creation, replay prevention per shipper/plan, ERC-721 ownership checks, reentrancy protection, carrier/operator permissions, and lifecycle state guards apply. Receipt transfers do not transfer settlement authority.
- **Evidence:** event logs, transaction receipts, block hashes/timestamps and gas usage are verified against the selected network. Explorer transaction visibility does not require source-code verification. For readable source verification, download the Solidity standard JSON input from the administrator panel, and submit it with the exact compiler version/build settings and contract path to Etherscan. Source verification is not automatically claimed.
- **Physical-world truth:** delivery/POD references are submitted by the assigned carrier. Blockchain preserves what was submitted; it does not independently prove physical delivery. No IoT oracle, GPS attestation, decentralized arbitration, or external bank-payment oracle is implemented.
- **AI remains off-chain:** CP-SAT and Logistic Regression run in the Python service. The chain receives agreement terms and a hash commitment, not the model or training dataset.
- **Operational limits:** public RPC availability/rate limits and wallet/user confirmation are external dependencies. This prototype has not received an independent smart-contract audit or production acceptance. Two confirmations can be reorganized; they are not finalized checkpoints. The original operator cannot be rotated in this deployment.

## Exact storage

The active local backend database is PostgreSQL **`chainroute_demo_20261027`**, host port **55432**, Docker volume **`chainroute_postgres-data`**. Migration **008_wallet_dapp.sql** adds `wallet_links`, `wallet_challenges`, `wallet_deployments`, `wallet_freights`, and `wallet_action_transactions`. These are wallet mappings, prepared immutable transaction intents, verified deployment addresses and indexed transaction/receipt records, keyed by network and deployment. They are **not the Sepolia ledger**.

The authoritative public-testnet state lives on the **Sepolia network's nodes**, accessed through JSON-RPC. Existing local-chain state remains Anvil `/data/chain.json` in volume **`chainroute_runtime_20261027_chain`**. AI logs remain SQLite `/data/optimization-runs.sqlite3` in **`chainroute_ai-run-logs`**. Orders, full allocation payloads, credentials/password hashes, roles and audit records remain off-chain. POD strings are references, not uploaded document storage; no IPFS storage is configured.

## Configuration and verification

Compose defaults `DAPP_CHAIN_ID=11155111`, `DAPP_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com`, `DAPP_ORIGIN=http://localhost:5173`. A dedicated provider URL can replace the public endpoint in the gitignored root `.env`. Docker builds compile/export the exact wallet deployment build; local development can run `npx hardhat compile` followed by `npx hardhat run scripts/export-dapp.js` in `blockchain/`. No MetaMask private-key environment setting is needed.

The recovery launch configuration remains `docker compose -f docker-compose.yml -f artifacts/runtime-20261027/compose.override.yml`. Updating only the API/UI uses `up -d --no-deps --build backend dashboard`; the legacy local deployment/state is preserved. Backend startup applies migration 008 automatically.

The local deployer recognizes the exact pre-DApp settlement runtime using a versioned fingerprint and its original immutable-reference positions, and still verifies the operator. This permits a full rebuild/restart to reuse existing local agreements after the internal creation hook was introduced. Other unknown or modified bytecode is rejected; the DApp contract does not replace this legacy deployment.

Validation: 64 Solidity tests, all 20 backend checks with PostgreSQL/live services, and 81 frontend tests pass; two optional frontend HTTP tests are skipped. Backend build and frontend production build pass. The isolated PostgreSQL + Anvil + live AI integration test verifies signed linking/replay rejection, deployment creation/runtime bytecode, prepared-term immutability, initiation/mint receipt matching, ownership privacy, all five booking-to-closure action transactions, and zero ETH freight balance. UI tests cover prerequisites, missing MetaMask, auditor restrictions and recovery/explorer links. The separate headless browser check passes at 375, 768 and 1280 pixels, with no page overflow, runtime errors, or serious/critical accessibility violations. The legacy deployer was run against the preserved local contract and reused it without redeployment. Evidence is saved locally under `artifacts/wallet-20261028/`; run `node scripts/wallet-browser-acceptance.cjs` with a valid `BROWSER_DEMO_PASSWORD` environment override if the live account password differs from the original seed setting. These local checks do not claim a live Sepolia transaction or a real wallet approval.

Sources: [Ethereum networks](https://ethereum.org/developers/docs/networks/), [proof of stake](https://ethereum.org/developers/docs/consensus-mechanisms/pos/), [Gasper](https://ethereum.org/developers/docs/consensus-mechanisms/pos/gasper/), [gas fees](https://ethereum.org/developers/docs/gas/), [MetaMask transaction requests](https://docs.metamask.io/metamask-connect/evm/reference/json-rpc-api/eth_sendTransaction/), [OpenZeppelin ERC-721](https://docs.openzeppelin.com/contracts/5.x/erc721).
