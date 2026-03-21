import re

with open('.github/workflows/deploy.yml', 'r') as f:
    content = f.read()

deploy_job_index = content.find('  deploy:')
deploy_job = content[deploy_job_index:]

new_header = """name: CI/CD Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  checks: write
  pull-requests: write

jobs:
  test-backend:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v5

      - name: Setup Python
        uses: actions/setup-python@v6
        with:
          python-version: '3.12'
          cache: 'pip'

      - name: Install dependencies
        working-directory: backend
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt

      - name: Backend checks + coverage tests
        working-directory: backend
        run: |
          python -m compileall app
          pytest

      - name: Publish Backend Test Results
        uses: EnricoMi/publish-unit-test-result-action@v2
        if: always()
        with:
          files: "backend/pytest-results.xml"
          check_name: "Backend Test Results"

      - name: Code Coverage Summary (Backend)
        uses: irongut/CodeCoverageSummary@v1.3.0
        if: always()
        with:
          filename: backend/coverage.xml
          badge: true
          fail_below_min: false
          format: markdown
          hide_branch_rate: false
          hide_complexity: true
          indicators: true
          output: both
          thresholds: '50 75'

      - name: Write Backend Coverage to Job Summary
        if: always()
        run: cat code-coverage-results.md >> $GITHUB_STEP_SUMMARY || true

  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v5

      - name: Setup Node
        uses: actions/setup-node@v5
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        working-directory: frontend
        run: npm ci

      - name: Frontend tests + coverage
        working-directory: frontend
        run: npm run test:coverage

      - name: Publish Frontend Test Results
        uses: EnricoMi/publish-unit-test-result-action@v2
        if: always()
        with:
          files: "frontend/vitest-results.xml"
          check_name: "Frontend Test Results"

      - name: Code Coverage Summary (Frontend)
        uses: irongut/CodeCoverageSummary@v1.3.0
        if: always()
        with:
          filename: frontend/coverage/cobertura-coverage.xml
          badge: true
          fail_below_min: false
          format: markdown
          hide_branch_rate: false
          hide_complexity: true
          indicators: true
          output: both
          thresholds: '50 75'

      - name: Write Frontend Coverage to Job Summary
        if: always()
        run: cat code-coverage-results.md >> $GITHUB_STEP_SUMMARY || true

      - name: Build frontend
        working-directory: frontend
        run: npm run build

"""

with open('.github/workflows/deploy.yml', 'w') as f:
    f.write(new_header + deploy_job)

print("Workflow updated successfully")
