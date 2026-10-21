-- Replay once to repair historical cache rows that used the most recent
-- same-action history hash while catching up multiple events in one batch.
-- Event identity remains the transaction hash + log index; corrected hashes
-- are copied from ledger history without creating duplicate cache entries.
UPDATE chain_sync_state
SET last_synced_block = 0, updated_at = now()
WHERE sync_name = 'settlement';
