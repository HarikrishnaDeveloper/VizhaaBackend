-- The profile form used to save free text (e.g. "Organizer") into "role",
-- which is the account type. Reset anything that isn't a real role to the
-- organizer default.
UPDATE "User" SET "role" = 'ORGANIZER' WHERE "role" NOT IN ('ADMIN', 'SUPPLIER', 'ORGANIZER');
