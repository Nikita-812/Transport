FROM python:3.13.5-slim

WORKDIR /app
COPY requirements-service.txt .
RUN pip install --no-cache-dir -r requirements-service.txt
COPY forecast_api.py .
COPY static ./static
ENV FORECAST_DIR=/app/artifacts/service
EXPOSE 8000
CMD ["uvicorn", "forecast_api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
