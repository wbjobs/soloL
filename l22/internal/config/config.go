package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server     ServerConfig     `yaml:"server"`
	JWT        JWTConfig        `yaml:"jwt"`
	Redis      RedisConfig      `yaml:"redis"`
	MySQL      MySQLConfig      `yaml:"mysql"`
	GRPC       GRPCConfig       `yaml:"grpc"`
	RateLimit  RateLimitConfig  `yaml:"rate_limit"`
	Etcd       EtcdConfig       `yaml:"etcd"`
	Preemption PreemptionConfig `yaml:"preemption"`
}

type ServerConfig struct {
	Host string `yaml:"host"`
	Port int    `yaml:"port"`
}

type JWTConfig struct {
	Secret      string `yaml:"secret"`
	ExpireHours int    `yaml:"expire_hours"`
}

type RedisConfig struct {
	Addr     string `yaml:"addr"`
	Password string `yaml:"password"`
	DB       int    `yaml:"db"`
}

type MySQLConfig struct {
	Host         string `yaml:"host"`
	Port         int    `yaml:"port"`
	User         string `yaml:"user"`
	Password     string `yaml:"password"`
	DBName       string `yaml:"dbname"`
	MaxOpenConns int    `yaml:"max_open_conns"`
	MaxIdleConns int    `yaml:"max_idle_conns"`
}

type GRPCConfig struct {
	ExecutorAddr string `yaml:"executor_addr"`
}

type RateLimitConfig struct {
	Capacity int `yaml:"capacity"`
	Rate     int `yaml:"rate"`
}

type EtcdConfig struct {
	Endpoints []string `yaml:"endpoints"`
	Username  string   `yaml:"username"`
	Password  string   `yaml:"password"`
}

type PreemptionConfig struct {
	DefaultStrategy  string  `yaml:"default_strategy"`
	LoadThreshold    float64 `yaml:"load_threshold"`
	MaxPreemptCount  int     `yaml:"max_preempt_count"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
