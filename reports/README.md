# Activity Reports

This folder contains database activity report scripts for different time periods.

## Available Reports

- `activity-report-1h.js` - Last 1 hour of activity
- `activity-report-2h.js` - Last 2 hours of activity
- `activity-report-4h.js` - Last 4 hours of activity
- `activity-report-12h.js` - Last 12 hours of activity
- `activity-report-24h.js` - Last 24 hours of activity

## Usage

Run any report from anywhere in the project (scripts automatically find the database):

From the project root:
```bash
node reports/activity-report-1h.js
node reports/activity-report-2h.js
node reports/activity-report-4h.js
node reports/activity-report-12h.js
node reports/activity-report-24h.js
```

Or from the reports directory:
```bash
cd reports
node activity-report-1h.js
node activity-report-2h.js
node activity-report-4h.js
node activity-report-12h.js
node activity-report-24h.js
```

## What Each Report Shows

Each report includes:

1. **Conversions Overview** - Total conversions, success/failure rates, and detailed list
2. **User Activity** - Activity grouped by IP address
3. **API Usage & Performance** - API calls, response times, token usage, and costs
4. **Contracts Generated** - Number and types of contracts created
5. **Validation & Errors** - Compilation results and error categories
6. **Retry Patterns** - Success rates by retry attempt number
7. **Summary** - Quick overview of key metrics

## Example Output

```
================================================================================
ACTIVITY REPORT - Last 1 Hour
================================================================================
Generated: 2025-11-19T17:00:00.000Z
Period: Since 2025-11-19T16:00:00.000Z
================================================================================

📊 CONVERSIONS OVERVIEW
...
```
