package taskexecutor

import (
	"context"

	"google.golang.org/grpc"
)

type SubmitTaskRequest struct {
	TaskId   int64  `protobuf:"varint,1,opt,name=task_id,json=taskId,proto3" json:"task_id,omitempty"`
	Name     string `protobuf:"bytes,2,opt,name=name,proto3" json:"name,omitempty"`
	Payload  string `protobuf:"bytes,3,opt,name=payload,proto3" json:"payload,omitempty"`
	Priority int32  `protobuf:"varint,4,opt,name=priority,proto3" json:"priority,omitempty"`
	UserId   int64  `protobuf:"varint,5,opt,name=user_id,json=userId,proto3" json:"user_id,omitempty"`
}

func (x *SubmitTaskRequest) Reset()         { *x = SubmitTaskRequest{} }
func (x *SubmitTaskRequest) String() string  { return "" }
func (x *SubmitTaskRequest) ProtoMessage()   {}

type SubmitTaskResponse struct {
	Success     bool   `protobuf:"varint,1,opt,name=success,proto3" json:"success,omitempty"`
	Message     string `protobuf:"bytes,2,opt,name=message,proto3" json:"message,omitempty"`
	ExecutionId string `protobuf:"bytes,3,opt,name=execution_id,json=executionId,proto3" json:"execution_id,omitempty"`
}

func (x *SubmitTaskResponse) Reset()         { *x = SubmitTaskResponse{} }
func (x *SubmitTaskResponse) String() string  { return "" }
func (x *SubmitTaskResponse) ProtoMessage()   {}

type QueryTaskRequest struct {
	TaskId int64 `protobuf:"varint,1,opt,name=task_id,json=taskId,proto3" json:"task_id,omitempty"`
}

func (x *QueryTaskRequest) Reset()         { *x = QueryTaskRequest{} }
func (x *QueryTaskRequest) String() string  { return "" }
func (x *QueryTaskRequest) ProtoMessage()   {}

type QueryTaskResponse struct {
	Success bool   `protobuf:"varint,1,opt,name=success,proto3" json:"success,omitempty"`
	Status  string `protobuf:"bytes,2,opt,name=status,proto3" json:"status,omitempty"`
	Result  string `protobuf:"bytes,3,opt,name=result,proto3" json:"result,omitempty"`
	Message string `protobuf:"bytes,4,opt,name=message,proto3" json:"message,omitempty"`
}

func (x *QueryTaskResponse) Reset()         { *x = QueryTaskResponse{} }
func (x *QueryTaskResponse) String() string  { return "" }
func (x *QueryTaskResponse) ProtoMessage()   {}

type CancelTaskRequest struct {
	TaskId int64 `protobuf:"varint,1,opt,name=task_id,json=taskId,proto3" json:"task_id,omitempty"`
}

func (x *CancelTaskRequest) Reset()         { *x = CancelTaskRequest{} }
func (x *CancelTaskRequest) String() string  { return "" }
func (x *CancelTaskRequest) ProtoMessage()   {}

type CancelTaskResponse struct {
	Success bool   `protobuf:"varint,1,opt,name=success,proto3" json:"success,omitempty"`
	Message string `protobuf:"bytes,2,opt,name=message,proto3" json:"message,omitempty"`
}

func (x *CancelTaskResponse) Reset()         { *x = CancelTaskResponse{} }
func (x *CancelTaskResponse) String() string  { return "" }
func (x *CancelTaskResponse) ProtoMessage()   {}

type TaskExecutorClient interface {
	SubmitTask(ctx context.Context, in *SubmitTaskRequest, opts ...grpc.CallOption) (*SubmitTaskResponse, error)
	QueryTask(ctx context.Context, in *QueryTaskRequest, opts ...grpc.CallOption) (*QueryTaskResponse, error)
	CancelTask(ctx context.Context, in *CancelTaskRequest, opts ...grpc.CallOption) (*CancelTaskResponse, error)
}

type taskExecutorClient struct {
	cc grpc.ClientConnInterface
}

func NewTaskExecutorClient(cc grpc.ClientConnInterface) TaskExecutorClient {
	return &taskExecutorClient{cc}
}

func (c *taskExecutorClient) SubmitTask(ctx context.Context, in *SubmitTaskRequest, opts ...grpc.CallOption) (*SubmitTaskResponse, error) {
	out := new(SubmitTaskResponse)
	err := c.cc.Invoke(ctx, "/taskexecutor.TaskExecutor/SubmitTask", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *taskExecutorClient) QueryTask(ctx context.Context, in *QueryTaskRequest, opts ...grpc.CallOption) (*QueryTaskResponse, error) {
	out := new(QueryTaskResponse)
	err := c.cc.Invoke(ctx, "/taskexecutor.TaskExecutor/QueryTask", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *taskExecutorClient) CancelTask(ctx context.Context, in *CancelTaskRequest, opts ...grpc.CallOption) (*CancelTaskResponse, error) {
	out := new(CancelTaskResponse)
	err := c.cc.Invoke(ctx, "/taskexecutor.TaskExecutor/CancelTask", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

type TaskExecutorServer interface {
	SubmitTask(context.Context, *SubmitTaskRequest) (*SubmitTaskResponse, error)
	QueryTask(context.Context, *QueryTaskRequest) (*QueryTaskResponse, error)
	CancelTask(context.Context, *CancelTaskRequest) (*CancelTaskResponse, error)
}

func RegisterTaskExecutorServer(s grpc.ServiceRegistrar, srv TaskExecutorServer) {
	s.RegisterService(&_TaskExecutor_serviceDesc, srv)
}

var _TaskExecutor_serviceDesc = grpc.ServiceDesc{
	ServiceName: "taskexecutor.TaskExecutor",
	HandlerType: (*TaskExecutorServer)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "SubmitTask",
		},
		{
			MethodName: "QueryTask",
		},
		{
			MethodName: "CancelTask",
		},
	},
	Streams:  []grpc.StreamDesc{},
	Metadata: "task_executor.proto",
}
