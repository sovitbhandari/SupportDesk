UPDATE users
SET password_hash = crypt(password_hash, gen_salt('bf', 10)),
    updated_at = now()
WHERE password_hash NOT LIKE '$2%';
