FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o timeline-wars-server ./cmd/main.go

FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

COPY --from=builder /app/timeline-wars-server .
COPY --from=builder /app/.env.example ./.env

EXPOSE 8080

CMD ["./timeline-wars-server"]
