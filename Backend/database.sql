CREATE DATABASE IF NOT EXISTS suave_db;
USE suave_db;

-- 1. Users Table (Stores institutional emails, roles, and securely hashed passwords)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL, -- Stores secure cryptographic hashes, never plain text
    role ENUM('student', 'adviser', 'admin') NOT NULL DEFAULT 'student',
    avatar_url TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bookings Table (Stores event proposals, venues, dates, and approval states)
CREATE TABLE IF NOT EXISTS bookings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    organization_name VARCHAR(255) NOT NULL,
    event_date DATE NOT NULL,
    venue VARCHAR(100) NOT NULL, -- e.g., 'Fourth Floor', 'Student Lounge', 'AVR'
    status ENUM('Under Review', 'Approved', 'Rejected') NOT NULL DEFAULT 'Under Review',
    rejection_reason TEXT NULL,
    google_form_url TEXT NULL,
    max_participants INT DEFAULT 50,
    current_registered INT DEFAULT 0,
    resources_needed TEXT NULL,
    user_id INT NOT NULL, -- Links the booking to the user who created it
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);