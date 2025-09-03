FROM python:3.11-slim

WORKDIR /api

ENV FLASK_APP=proxy_api.py
ENV FLASK_ENV=development

ADD requirements.txt /api

# Install system deps & CA bundle
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

RUN pip install -r requirements.txt

ADD . /api

#CMD ["flask", "run", "-h", "0.0.0.0", "-p", "${PORT}" ]
CMD python ./proxy_api.py