package crypto

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

type TypedValue struct {
	Type  DataType
	Value interface{}
}

type TypedCodec struct {
	engine *RC4Engine
}

func NewTypedCodec(engine *RC4Engine) *TypedCodec {
	return &TypedCodec{
		engine: engine,
	}
}

func (c *TypedCodec) inferType(rawValue string) DataType {
	trimmed := strings.TrimSpace(rawValue)
	
	if trimmed == "NULL" || trimmed == "null" || trimmed == "" {
		return TypeBytes
	}
	
	if _, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
		return TypeInt64
	}
	
	if _, err := strconv.ParseFloat(trimmed, 64); err == nil {
		return TypeFloat64
	}
	
	if strings.EqualFold(trimmed, "true") || strings.EqualFold(trimmed, "false") {
		return TypeBool
	}
	
	return TypeString
}

func (c *TypedCodec) parseValue(rawValue string, dataType DataType) (interface{}, error) {
	trimmed := strings.Trim(rawValue, "'\" ")
	
	switch dataType {
	case TypeInt64:
		return strconv.ParseInt(trimmed, 10, 64)
	case TypeFloat64:
		return strconv.ParseFloat(trimmed, 64)
	case TypeBool:
		return strconv.ParseBool(trimmed)
	case TypeString:
		return trimmed, nil
	case TypeBytes:
		if strings.HasPrefix(trimmed, "0x") || strings.HasPrefix(trimmed, "X'") {
			hexStr := strings.TrimPrefix(trimmed, "0x")
			hexStr = strings.Trim(hexStr, "X'")
			return hexStr, nil
		}
		return []byte(trimmed), nil
	default:
		return nil, errors.New("unknown data type")
	}
}

func (c *TypedCodec) encodeValue(value interface{}, dataType DataType) ([]byte, error) {
	switch dataType {
	case TypeInt64:
		v, ok := value.(int64)
		if !ok {
			return nil, errors.New("value is not int64")
		}
		buf := make([]byte, 8)
		binary.BigEndian.PutUint64(buf, uint64(v))
		return buf, nil
	case TypeFloat64:
		v, ok := value.(float64)
		if !ok {
			return nil, errors.New("value is not float64")
		}
		bits := math.Float64bits(v)
		buf := make([]byte, 8)
		binary.BigEndian.PutUint64(buf, bits)
		return buf, nil
	case TypeBool:
		v, ok := value.(bool)
		if !ok {
			return nil, errors.New("value is not bool")
		}
		if v {
			return []byte{1}, nil
		}
		return []byte{0}, nil
	case TypeString:
		v, ok := value.(string)
		if !ok {
			return nil, errors.New("value is not string")
		}
		return []byte(v), nil
	case TypeBytes:
		switch v := value.(type) {
		case []byte:
			return v, nil
		case string:
			return []byte(v), nil
		default:
			return nil, errors.New("value is not bytes")
		}
	default:
		return nil, errors.New("unknown data type")
	}
}

func (c *TypedCodec) decodeValue(data []byte, dataType DataType) (interface{}, error) {
	switch dataType {
	case TypeInt64:
		if len(data) != 8 {
			return nil, fmt.Errorf("invalid int64 data length: %d", len(data))
		}
		return int64(binary.BigEndian.Uint64(data)), nil
	case TypeFloat64:
		if len(data) != 8 {
			return nil, fmt.Errorf("invalid float64 data length: %d", len(data))
		}
		bits := binary.BigEndian.Uint64(data)
		return math.Float64frombits(bits), nil
	case TypeBool:
		if len(data) != 1 {
			return nil, fmt.Errorf("invalid bool data length: %d", len(data))
		}
		return data[0] == 1, nil
	case TypeString:
		return string(data), nil
	case TypeBytes:
		return data, nil
	default:
		return nil, errors.New("unknown data type")
	}
}

func (c *TypedCodec) EncryptTyped(rawValue string, version int, expectedType DataType) ([]byte, error) {
	var dataType DataType
	if expectedType != TypeBytes {
		dataType = expectedType
	} else {
		dataType = c.inferType(rawValue)
	}
	
	parsedValue, err := c.parseValue(rawValue, dataType)
	if err != nil {
		return nil, fmt.Errorf("parse value failed: %w", err)
	}
	
	encodedData, err := c.encodeValue(parsedValue, dataType)
	if err != nil {
		return nil, fmt.Errorf("encode value failed: %w", err)
	}
	
	dataToEncrypt := make([]byte, 1+len(encodedData))
	dataToEncrypt[0] = byte(dataType)
	copy(dataToEncrypt[1:], encodedData)
	
	encrypted, err := c.engine.Encrypt(dataToEncrypt, version)
	if err != nil {
		return nil, err
	}
	
	return encrypted, nil
}

func (c *TypedCodec) EncryptTypedLatest(rawValue string, expectedType DataType) ([]byte, error) {
	version := c.engine.GetLatestVersion()
	return c.EncryptTyped(rawValue, version, expectedType)
}

func (c *TypedCodec) DecryptTyped(ciphertext []byte) (*TypedValue, error) {
	if len(ciphertext) < 5 {
		return nil, errors.New("invalid ciphertext length")
	}
	
	decrypted, err := c.engine.Decrypt(ciphertext)
	if err != nil {
		return nil, err
	}
	
	if len(decrypted) < 1 {
		return nil, errors.New("decrypted data too short")
	}
	
	dataType := DataType(decrypted[0])
	if dataType < TypeString || dataType > TypeBytes {
		return nil, fmt.Errorf("invalid data type: %d (possibly wrong key)", dataType)
	}
	
	data := decrypted[1:]
	
	value, err := c.decodeValue(data, dataType)
	if err != nil {
		return nil, fmt.Errorf("decode value failed: %w", err)
	}
	
	return &TypedValue{
		Type:  dataType,
		Value: value,
	}, nil
}

func (c *TypedCodec) FormatValue(tv *TypedValue) string {
	switch tv.Type {
	case TypeInt64:
		return fmt.Sprintf("%d", tv.Value.(int64))
	case TypeFloat64:
		return fmt.Sprintf("%f", tv.Value.(float64))
	case TypeBool:
		if tv.Value.(bool) {
			return "TRUE"
		}
		return "FALSE"
	case TypeString:
		return fmt.Sprintf("'%s'", tv.Value.(string))
	case TypeBytes:
		if b, ok := tv.Value.([]byte); ok {
			return fmt.Sprintf("X'%x'", b)
		}
		return fmt.Sprintf("'%s'", tv.Value.(string))
	default:
		return fmt.Sprintf("%v", tv.Value)
	}
}

func (c *TypedCodec) FormatValueForQuery(tv *TypedValue) string {
	switch tv.Type {
	case TypeInt64:
		return fmt.Sprintf("%d", tv.Value.(int64))
	case TypeFloat64:
		return fmt.Sprintf("%f", tv.Value.(float64))
	case TypeBool:
		if tv.Value.(bool) {
			return "TRUE"
		}
		return "FALSE"
	case TypeString:
		return fmt.Sprintf("'%s'", escapeSQLString(tv.Value.(string)))
	case TypeBytes:
		if b, ok := tv.Value.([]byte); ok {
			return fmt.Sprintf("X'%x'", b)
		}
		return fmt.Sprintf("'%s'", escapeSQLString(tv.Value.(string)))
	default:
		return fmt.Sprintf("%v", tv.Value)
	}
}

func escapeSQLString(s string) string {
	var builder strings.Builder
	for _, r := range s {
		switch r {
		case '\'':
			builder.WriteString("''")
		case '\\':
			builder.WriteString("\\\\")
		default:
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func (t DataType) String() string {
	switch t {
	case TypeString:
		return "string"
	case TypeInt64:
		return "int64"
	case TypeFloat64:
		return "float64"
	case TypeBool:
		return "bool"
	case TypeBytes:
		return "bytes"
	default:
		return "unknown"
	}
}

func (t TypedValue) String() string {
	return fmt.Sprintf("%s(%v)", t.Type, t.Value)
}

func SerializeTypedValue(tv *TypedValue) ([]byte, error) {
	return json.Marshal(tv)
}

func DeserializeTypedValue(data []byte) (*TypedValue, error) {
	var tv TypedValue
	err := json.Unmarshal(data, &tv)
	if err != nil {
		return nil, err
	}
	return &tv, nil
}
