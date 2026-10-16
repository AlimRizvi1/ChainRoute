FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY ai-engine/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ai-engine/app.py .
COPY ai-engine/allocator.py .
COPY ai-engine/models.py .
COPY ai-engine/ranking.py .
COPY ai-engine/synthetic_data.py .

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
