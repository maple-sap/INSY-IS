CREATE DATABASE IF NOT EXISTS suave_db;
USE suave_db;

-- 1. Users Table (Stores institutional emails, roles, and securely hashed passwords)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL, -- Stores secure cryptographic hashes, never plain text
    role ENUM('student', 'adviser', 'admin', 'osas') NOT NULL DEFAULT 'student',
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
    start_time TIME NULL, -- Event start time
    end_time TIME NULL, -- Event end time
    venue VARCHAR(100) NOT NULL, -- e.g., 'Fourth Floor', 'Student Lounge', 'AVR'
    status VARCHAR(50) NOT NULL DEFAULT 'Under Review - OSAS', -- 'Under Review - OSAS', 'Under Review - Adviser', 'Approved', 'Rejected'
    rejection_reason TEXT NULL,
    google_form_url TEXT NULL,
    max_participants INT DEFAULT 50,
    current_registered INT DEFAULT 0,
    resources_needed TEXT NULL,
    proposal_file VARCHAR(255) NULL, -- Uploaded PDF proposal filename
    compliance_status VARCHAR(20) NOT NULL DEFAULT 'Pending', -- Pending, Submitted or Verified
    cleanliness_proof VARCHAR(255) NULL, -- Uploaded venue cleanliness photo filename
    resources_returned TINYINT(1) NOT NULL DEFAULT 0, -- Student certified equipment returned
    compliance_submitted_at DATETIME NULL,
    equipment_checklist TEXT NULL, -- JSON list of {item, status: Returned/Damaged/Missing}
    compliance_remarks TEXT NULL, -- Student notes about damaged/missing items
    compliance_verified_by INT NULL, -- OSAS/Admin user who signed off
    compliance_verified_at DATETIME NULL,
    user_id INT NOT NULL, -- Links the booking to the user who created it
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Survey Responses Table (System evaluation: one response per user; scores computed by the server)
CREATE TABLE IF NOT EXISTS survey_responses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    sus_answers TEXT NOT NULL, -- JSON array of 10 ratings (1-5), standard SUS items
    fs_answers TEXT NOT NULL, -- JSON array of 4 ratings (1-5), functional suitability items
    sus_score DECIMAL(5,1) NOT NULL, -- 0-100
    functional_score DECIMAL(5,1) NOT NULL, -- 0-100 (mean rating / 5)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);