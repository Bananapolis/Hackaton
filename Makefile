.PHONY: backend-install backend-check backend-run frontend-install frontend-build frontend-dev

backend-install:
	cd backend && pip install -r requirements.txt

backend-check:
	cd backend && python -m compileall app

backend-run:
	cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 9000

frontend-install:
	cd frontend && npm install

frontend-build:
	cd frontend && npm run build

frontend-dev:
	cd frontend && npm run dev -- --host 0.0.0.0 --port 5173
