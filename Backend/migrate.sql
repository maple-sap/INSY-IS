-- S.U.A.V.E. Database Migration Script
-- Run this if your suave_db already exists and you need to add missing columns.

USE suave_db;

-- Add 'osas' to the users role ENUM (if not already present)
ALTER TABLE users
    MODIFY COLUMN role ENUM('student', 'adviser', 'admin', 'osas') NOT NULL DEFAULT 'student';

-- Add missing columns to the bookings table (if not already present)
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS compliance_status ENUM('N/A', 'Pending', 'Complied') NOT NULL DEFAULT 'N/A',
    ADD COLUMN IF NOT EXISTS cleanliness_proof VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS resources_returned TINYINT(1) NOT NULL DEFAULT 0;
