package rabbitmq

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/streadway/amqp"
	"gene-alignment/pkg/models"
)

const (
	TaskQueueName = "alignment_tasks"
)

type Client struct {
	conn       *amqp.Connection
	channel    *amqp.Channel
	messageTTL time.Duration
}

func NewClient(url string, messageTTL time.Duration) (*Client, error) {
	conn, err := amqp.Dial(url)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to RabbitMQ: %w", err)
	}

	ch, err := conn.Channel()
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to open channel: %w", err)
	}

	args := amqp.Table{
		"x-queue-mode": "lazy",
	}

	_, err = ch.QueueDeclare(
		TaskQueueName,
		true,
		false,
		false,
		false,
		args,
	)
	if err != nil {
		ch.Close()
		conn.Close()
		return nil, fmt.Errorf("failed to declare queue: %w", err)
	}

	if err := ch.Qos(1, 0, false); err != nil {
		log.Printf("Warning: failed to set QoS: %v", err)
	}

	return &Client{
		conn:       conn,
		channel:    ch,
		messageTTL: messageTTL,
	}, nil
}

func (c *Client) Close() {
	if c.channel != nil {
		c.channel.Close()
	}
	if c.conn != nil {
		c.conn.Close()
	}
}

func (c *Client) PublishTask(msg models.AlignmentTaskMessage) error {
	body, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	expiration := fmt.Sprintf("%d", c.messageTTL.Milliseconds())

	err = c.channel.Publish(
		"",
		TaskQueueName,
		false,
		false,
		amqp.Publishing{
			DeliveryMode: amqp.Persistent,
			ContentType:  "application/json",
			Body:         body,
			Expiration:   expiration,
			Timestamp:    time.Now(),
		},
	)
	if err != nil {
		return fmt.Errorf("failed to publish message: %w", err)
	}

	return nil
}

func (c *Client) ConsumeTasks(handler func(models.AlignmentTaskMessage) error) error {
	msgs, err := c.channel.Consume(
		TaskQueueName,
		"",
		false,
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		return fmt.Errorf("failed to register consumer: %w", err)
	}

	forever := make(chan bool)

	go func() {
		for d := range msgs {
			var msg models.AlignmentTaskMessage
			if err := json.Unmarshal(d.Body, &msg); err != nil {
				log.Printf("Error unmarshaling message: %v", err)
				d.Nack(false, false)
				continue
			}

			if err := handler(msg); err != nil {
				log.Printf("Error handling task: %v", err)
				d.Nack(false, true)
				continue
			}

			d.Ack(false)
		}
	}()

	log.Printf(" [*] Waiting for messages. To exit press CTRL+C")
	<-forever

	return nil
}

func (c *Client) GetQueueLength() (int, error) {
	q, err := c.channel.QueueInspect(TaskQueueName)
	if err != nil {
		return 0, fmt.Errorf("failed to inspect queue: %w", err)
	}
	return q.Messages, nil
}

func (c *Client) GetConsumerCount() (int, error) {
	q, err := c.channel.QueueInspect(TaskQueueName)
	if err != nil {
		return 0, fmt.Errorf("failed to inspect queue: %w", err)
	}
	return q.Consumers, nil
}

func (c *Client) PurgeQueue() (int, error) {
	count, err := c.channel.QueuePurge(TaskQueueName, false)
	if err != nil {
		return 0, fmt.Errorf("failed to purge queue: %w", err)
	}
	return count, nil
}
