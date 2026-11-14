ALTER TABLE signal_class_annotations ADD COLUMN IF NOT EXISTS ambiguous boolean NOT NULL DEFAULT false;
