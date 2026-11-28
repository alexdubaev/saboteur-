CREATE TABLE profiles (
  user_id uuid PRIMARY KEY,
  name text NOT NULL,
  avatar_id text NOT NULL
);

CREATE TABLE guest_sessions (
  token_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles (user_id),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX guest_sessions_expiry_idx ON guest_sessions (expires_at);

CREATE TABLE rooms (
  room_id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  host_seat_id uuid,
  turn_timeout_seconds integer CHECK (turn_timeout_seconds BETWEEN 5 AND 300),
  current_match_id uuid,
  sequence integer NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  expires_at timestamptz
);

CREATE TABLE seats (
  seat_id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles (user_id),
  name text NOT NULL,
  avatar_id text NOT NULL,
  ready boolean NOT NULL DEFAULT FALSE,
  position integer NOT NULL CHECK (position >= 0),
  UNIQUE (room_id, position),
  UNIQUE (room_id, user_id),
  UNIQUE (room_id, seat_id)
);

ALTER TABLE rooms ADD CONSTRAINT rooms_host_seat_fk
  FOREIGN KEY (room_id, host_seat_id) REFERENCES seats (room_id, seat_id);

CREATE TABLE matches (
  match_id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  ruleset_id text NOT NULL,
  profile_version integer NOT NULL,
  profile_digest text NOT NULL,
  rng_secret bytea NOT NULL,
  revision integer NOT NULL CHECK (revision >= 0),
  state jsonb NOT NULL CHECK (state @> '{"schemaVersion":1}'),
  deadline_at timestamptz,
  automation_at timestamptz,
  UNIQUE (room_id, match_id)
);

CREATE UNIQUE INDEX rooms_current_match_idx ON rooms (current_match_id) WHERE current_match_id IS NOT NULL;
CREATE INDEX matches_automation_due_idx ON matches (automation_at) WHERE automation_at IS NOT NULL;
ALTER TABLE rooms ADD CONSTRAINT rooms_current_match_fk
  FOREIGN KEY (room_id, current_match_id) REFERENCES matches (room_id, match_id);

CREATE TABLE reward_ledger (
  match_id uuid NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
  round_no integer NOT NULL CHECK (round_no > 0),
  seat_id uuid NOT NULL,
  points integer NOT NULL CHECK (points >= 0),
  PRIMARY KEY (match_id, round_no, seat_id)
);

CREATE TABLE journal_events (
  room_id uuid NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  match_id uuid REFERENCES matches (match_id) ON DELETE CASCADE,
  actor_seat_id uuid,
  type text NOT NULL,
  revision integer NOT NULL,
  public_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, sequence)
);

CREATE TABLE command_receipts (
  room_id uuid NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  match_scope text NOT NULL,
  actor_seat_id text NOT NULL,
  command_id text NOT NULL,
  digest text NOT NULL,
  ack jsonb NOT NULL,
  PRIMARY KEY (room_id, match_scope, actor_seat_id, command_id)
);

CREATE TABLE chat_messages (
  message_id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  seat_id uuid NOT NULL,
  author_name text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, sequence)
);
