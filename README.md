# ThrustBench — UAV Motor Thrust Measurement System

> A= real-time performance measurement rig for Brushless DC (BLDC) motors used in aerial robots (UAVs/drones), built on the ESP32 microcontroller with a web-based dashboard.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Hardware Components](#hardware-components)
- [System Architecture](#system-architecture)
- [Wiring & Circuit](#wiring--circuit)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Flashing the Firmware](#flashing-the-firmware)
  - [Uploading the Dashboard (SPIFFS)](#uploading-the-dashboard-spiffs)
  - [Connecting to the Dashboard](#connecting-to-the-dashboard)
- [Dashboard Usage](#dashboard-usage)
- [Data Logging](#data-logging)
- [API Reference](#api-reference)
- [Experimental Results Summary](#experimental-results-summary)
- [Team](#team)
- [License](#license)

---

## Overview

**ThrustBench** is a low-cost, modular motor performance test rig designed to measure thrust, voltage, current, power, and efficiency of UAV BLDC motors in real time. The system bridges the gap between manufacturer datasheets and real-world motor performance by providing an accurate, reproducible, and IoT-enabled bench test platform.

The rig was developed as a final-year B.E. Mechatronics Engineering project at **Kumaraguru College of Technology, Coimbatore**, under the guidance of **Mr. R. Raffik**, Assistant Professor II.

**Tested motor:** EMAX 1500 KV BLDC  
**Tested propellers:** 5-inch, 7-inch, 10-inch  
**Key finding:** The 7-inch propeller achieves the best thrust-to-power ratio for medium-class UAVs.

---

## Features

- ✅ **Real-time web dashboard** — accessible from any Wi-Fi device (laptop/phone)
- ✅ **Live sensor graphs** — Voltage, Current, Power, Load (kg), Throttle plotted as time-series
- ✅ **Throttle Test** — manual slider control with Arm/Disarm safety
- ✅ **Thrust Test** — automated ramp from 0 → target%, configurable ramp time and log interval
- ✅ **SD card logging** — CSV files auto-saved with motor metadata, peak current, and ESC recommendation
- ✅ **Motor metadata storage** — brand, motor name, KV rating, propeller, description saved to SPIFFS
- ✅ **Log management** — list, download, and analyse past test CSVs from the dashboard
- ✅ **ESC sizing recommendation** — automatically calculates 1.5× peak current for ESC selection
- ✅ **External wind simulation** — secondary motor simulates in-flight aerodynamic conditions

---

## Hardware Components

| Component | Description | Qty |
|---|---|---|
| ESP32 (WROVER-KIT) | Central control, data acquisition, Wi-Fi web server | 1 |
| BLDC Motor (EMAX 1500 KV) | Primary motor under test | 1 |
| BLDC Motor (secondary) | External wind generator for aerodynamic simulation | 2 |
| Electronic Speed Controller (ESC) | Motor speed regulation via PWM | 3 |
| Load Cell (10 kg, single-point) | Thrust force measurement | 1 |
| HX711 Load Cell Amplifier | 24-bit ADC for load cell signal conditioning | 1 |
| 16-bit ADC Module | Accurate voltage and current measurement | 1 |
| Power Module | Voltage/current monitoring; distributes power to ESCs | 1 |
| Li-Po Battery | Primary power source | 1 |
| Micro SD Card Module | CSV data logging | 1 |
| Aluminium Extrusion Frame | Rigid, modular structural support | 1 set |

---

## System Architecture

```
Li-Po Battery
      │
  Power Module ──── Voltage / Current ──► 16-bit ADC ──► ESP32
      │
   ┌──┴──┐
  ESC   ESC(s)            Load Cell ──► HX711 ──► ESP32
   │     │
 Main  Wind
Motor  Motors
   │
Propeller
(thrust)
         ESP32
           │
    ┌──────┴──────┐
  SPIFFS        SD Card
(dashboard)   (CSV logs)
           │
        Wi-Fi AP
           │
     Web Browser
    (Any device)
```

The ESP32 runs as a **Wi-Fi Access Point** (`ESP32-Web`), hosts the dashboard via an HTTP web server on port 80 (SPIFFS), controls motor throttle through PWM to the ESC, reads thrust from the load cell via HX711, reads electrical parameters via a 16-bit ADC, and logs all data to the micro SD card.

---

## Wiring & Circuit

### SD Card (SPI)

| SD Pin | ESP32 GPIO |
|--------|------------|
| SCK    | 18         |
| MISO   | 19         |
| MOSI   | 23         |
| CS     | 5          |

### HX711 (Load Cell Amplifier)

| HX711 Pin | ESP32 GPIO |
|-----------|------------|
| DT (Data) | As configured in firmware |
| SCK (Clock) | As configured in firmware |
| VCC | 3.3 V |
| GND | GND |

### ESC

Each ESC signal wire connects to an ESP32 GPIO pin. The ESC receives PWM signals (1–2 ms pulse, 50–400 Hz) for throttle control.

> ⚠️ **Safety:** Always arm the motor only after confirming the propeller area is clear. Use the Arm/Disarm button on the dashboard before adjusting throttle.

---

## Project Structure

```
ThrustBench-main/
├── src/
│   └── main.cpp            # ESP32 firmware — web server, sensor reading, test logic
├── data/
│   ├── index.html          # Dashboard UI (served via SPIFFS)
│   └── assets/
│       ├── app.css         # Dashboard styling
│       └── app.js          # Dashboard logic (charts, API calls)
├── include/
│   └── README              # PlatformIO include folder placeholder
├── lib/
│   └── README              # PlatformIO lib folder placeholder
├── test/
│   └── README              # PlatformIO test folder placeholder
├── platformio.ini          # PlatformIO build configuration
├── .gitignore
└── .vscode/
    ├── extensions.json
    └── settings.json
```

---

## Getting Started

### Prerequisites

- [PlatformIO IDE](https://platformio.org/) (VS Code extension recommended)
- ESP32 board (WROVER-KIT or compatible)
- USB cable for flashing
- A formatted micro SD card (FAT32)

### Flashing the Firmware

1. Clone this repository:
   ```bash
   git clone https://github.com/<your-username>/ThrustBench.git
   cd ThrustBench
   ```

2. Open the project in VS Code with PlatformIO installed.

3. *(Optional)* Edit Wi-Fi credentials in `src/main.cpp` if you want a custom SSID/password:
   ```cpp
   const char* AP_SSID     = "ESP32-Web";
   const char* AP_PASSWORD = "esp32web";
   ```

4. Edit the SD SPI pin definitions if your wiring differs:
   ```cpp
   #define SD_SCK   18
   #define SD_MISO  19
   #define SD_MOSI  23
   #define SD_CS     5
   ```

5. Build and upload the firmware:
   ```
   PlatformIO: Upload  (Ctrl+Alt+U)
   ```

### Uploading the Dashboard (SPIFFS)

The web dashboard files in `data/` must be uploaded to the ESP32's SPIFFS filesystem separately:

```
PlatformIO: Upload Filesystem Image
```

> In PlatformIO, this is found under **Project Tasks → esp-wrover-kit → Platform → Upload Filesystem Image**.

### Connecting to the Dashboard

1. Power on the ESP32.
2. On your phone or laptop, connect to the Wi-Fi network:
   - **SSID:** `ESP32-Web`
   - **Password:** `esp32web`
3. Open a browser and go to: **http://192.168.4.1**

---

## Dashboard Usage

The dashboard has three tabs:

### 🏠 Home
Welcome screen with quick navigation hints.

### 📡 Live
Main testing interface:

| Section | Description |
|---|---|
| **Motor Setup Details** | Enter motor brand, name, KV rating, propeller size, and notes. Saved to SPIFFS. |
| **Voltage / Current / Power / Load graphs** | Real-time time-series charts updating continuously. |
| **Throttle Test** | Manual throttle slider (0–100%). Press **Arm** to enable, press again to **Disarm** (resets to 0%). |
| **Thrust Test** | Set a target throttle %, log step interval (s), and ramp time (s). Press **Start Test** to run an automated ramp sequence. A **Stop** button aborts the test safely. |

After each Thrust Test, the dashboard shows:
- Peak current recorded
- Recommended ESC rating (1.5 × peak current)
- Path of the saved CSV log on the SD card

### 📊 Analysis
Load and visualize previously saved CSV logs. Configure which parameters to plot on each of the four graph panels (axes are freely selectable: TIME, THROTTLE, VOLTAGE, CURRENT, KG, POWER, EFFICIENCY). Graph layout preferences are saved to ESP32 NVS (non-volatile storage).

---

## Data Logging

Each completed Thrust Test automatically saves a CSV file to the SD card at `/logs/`. The filename is generated from the motor metadata and a millisecond timestamp for uniqueness.

**CSV format:**
```
MOTOR BRAND:,EMAX
MOTOR:,Elite
KV:,1000
PROPELLER:,5050
DESCRIPTION:
...
PEAK_CURRENT_A:,9.130
RECOMMENDED_ESC_A:,13.695

TIME,THROTTLE,VOLTAGE,CURRENT,KG,POWER,EFFICIENCY
0.000,0,12.123,0.000,0.000,0.000,0.000000
0.500,5,12.100,0.523,0.041,6.328,0.006480
...
```

- Aborted tests (via Stop button) are **not** saved.
- Logs can be listed and downloaded directly from the **Analysis** tab.

---

## API Reference

All endpoints are served by the ESP32 HTTP server at `http://192.168.4.1`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/live` | Returns current sensor readings as JSON `{ts, v, i, kg}` |
| POST | `/api/set_throttle?pct=<0-100>` | Sets manual throttle (blocked during active test) |
| POST | `/api/start_thrust_test?pct=<target>&step_s=<s>&ramp_s=<s>` | Starts automated thrust test |
| POST | `/api/stop_thrust_test` | Aborts running test, disarms motor immediately |
| GET | `/api/test_status` | Returns test state, sample count, SD status, log file path |
| GET | `/api/logs` | Lists all CSV files saved on SD card |
| GET | `/api/log_download?file=/logs/<name>.csv` | Downloads a CSV log file |
| GET | `/api/meta` | Returns saved motor metadata JSON |
| POST | `/api/meta` | Saves motor metadata (`brand`, `motor`, `kv`, `prop`, `desc`) |
| GET | `/api/analysis_pref` | Returns saved graph layout configuration |
| POST | `/api/analysis_pref` | Saves graph layout configuration |

---

## Experimental Results Summary

Tests were conducted with an **EMAX 1500 KV BLDC motor** at incremental throttle levels using three propeller sizes.

### 5-inch Propeller (0–60% throttle)

| Throttle (%) | Voltage (V) | Current (A) | Thrust (kg) | Power (W) |
|---|---|---|---|---|
| 10 | 16.836 | 0.259 | 0.029 | 4.33 |
| 30 | 15.971 | 2.410 | 0.152 | 38.50 |
| 60 | 14.799 | 5.960 | 0.301 | 88.20 |

### 7-inch Propeller (0–60% throttle)

| Throttle (%) | Voltage (V) | Current (A) | Thrust (kg) | Power (W) |
|---|---|---|---|---|
| 10 | 16.731 | 0.353 | 0.026 | 5.91 |
| 30 | 15.909 | 3.214 | 0.276 | 51.14 |
| 60 | 14.143 | 9.130 | 0.607 | 129.13 |

### 10-inch Propeller (0–40% throttle, limited due to vibration)

| Throttle (%) | Voltage (V) | Current (A) | Thrust (kg) | Power (W) |
|---|---|---|---|---|
| 10 | 18.477 | 0.364 | 0.084 | 6.73 |
| 20 | 18.360 | 2.313 | 0.283 | 42.47 |
| 40 | 17.797 | 11.809 | 0.957 | 210.17 |

### Comparison

| Propeller | Max Thrust | Current Draw | Efficiency | Best For |
|---|---|---|---|---|
| 5-inch | Low | Low | Moderate | Micro / Racing drones |
| **7-inch** | **Medium** | **Moderate** | **High (Optimal)** | **Medium UAVs / Survey** |
| 10-inch | High | High | Moderate–Low | Heavy-lift UAVs |

> **Key finding:** The 7-inch propeller offers the best thrust-to-power ratio. The motor operates most efficiently between **40–60% throttle** across all propeller sizes.

---

## Team

**Kumaraguru College of Technology, Coimbatore — Department of Mechatronics Engineering (Batch 2022–2026)**

| Name | Roll No. |
|---|---|
| Bhairav Shakthi U E | 22BMC004 |
| Karthi M | 22BMC019 |
| Sankarasurya V | 22BMC041 |
| Yuvaraj M V | 22BMC063 |

**Project Guide:** Mr. R. Raffik, Assistant Professor II  
**Head of Department:** Dr. M. Saravana Mohan

---

## License

This project is intended for academic and research purposes. Feel free to use and adapt it with appropriate credit to the authors.
