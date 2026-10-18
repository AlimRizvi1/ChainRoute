ALTER TABLE users
    ADD COLUMN password_hash text,
    ADD CONSTRAINT users_password_hash_scrypt_format CHECK (
        password_hash IS NULL OR password_hash ~
        '^scrypt\$131072\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$'
    );

ALTER TABLE audit_trail
    ADD CONSTRAINT audit_trail_request_id_unique UNIQUE (request_id);
