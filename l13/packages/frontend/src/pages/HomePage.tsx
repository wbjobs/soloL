import React, { useState, useCallback, useEffect } from 'react';
import {
  Upload,
  Button,
  Form,
  Input,
  Card,
  List,
  message,
  Space,
  Typography,
} from 'antd';
import {
  UploadOutlined,
  VideoCameraOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { createProject, listProjects } from '../api/project';
import { createRoom } from '../api/room';
import { useProjectStore } from '../stores/project-store';
import dayjs from 'dayjs';

const { Title } = Typography;

interface UploadFormValues {
  name: string;
}

export const HomePage: React.FC = () => {
  const [form] = Form.useForm<UploadFormValues>();
  const [uploading, setUploading] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const navigate = useNavigate();

  const { projectList, setProjectList, setLoading } = useProjectStore();

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const projects = await listProjects();
      setProjectList(projects);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }, [setProjectList, setLoading]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleSubmit = useCallback(
    async (values: UploadFormValues) => {
      if (!videoFile || !srtFile) {
        message.warning('Please select both video and SRT files');
        return;
      }

      setUploading(true);
      try {
        const project = await createProject(values.name, videoFile, srtFile);
        message.success('Project created successfully');
        navigate(`/project/${project.id}`);
      } catch (err) {
        message.error('Failed to create project');
        console.error(err);
      } finally {
        setUploading(false);
      }
    },
    [videoFile, srtFile, navigate],
  );

  const handleCreateRoom = useCallback(
    async (projectId: string) => {
      try {
        const room = await createRoom({ projectId, name: `Room for ${projectId}` });
        navigate(`/room/${room.id}`);
      } catch (err) {
        message.error('Failed to create room');
        console.error(err);
      }
    },
    [navigate],
  );

  return (
    <div className="home-page">
      <div className="home-page__hero">
        <Title level={2}>Subtitle Proofread Platform</Title>
        <p>Upload a video and SRT file to start proofreading subtitles collaboratively.</p>
      </div>

      <Card title="Create New Project" className="home-page__upload-card">
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="Project Name"
            rules={[{ required: true, message: 'Please enter a project name' }]}
          >
            <Input placeholder="My subtitle project" />
          </Form.Item>

          <Form.Item label="Video File" required>
            <Upload
              beforeUpload={(file) => {
                setVideoFile(file);
                return false;
              }}
              maxCount={1}
              accept="video/*"
              onRemove={() => setVideoFile(null)}
            >
              <Button icon={<VideoCameraOutlined />}>Select Video</Button>
            </Upload>
          </Form.Item>

          <Form.Item label="SRT File" required>
            <Upload
              beforeUpload={(file) => {
                setSrtFile(file);
                return false;
              }}
              maxCount={1}
              accept=".srt,.vtt"
              onRemove={() => setSrtFile(null)}
            >
              <Button icon={<UploadOutlined />}>Select SRT</Button>
            </Upload>
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={uploading} icon={<PlusOutlined />}>
              Create Project
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="Recent Projects" className="home-page__projects-card" style={{ marginTop: 24 }}>
        <List
          dataSource={projectList}
          locale={{ emptyText: 'No projects yet' }}
          renderItem={(project) => (
            <List.Item
              actions={[
                <Button
                  key="open"
                  type="link"
                  onClick={() => navigate(`/project/${project.id}`)}
                >
                  Open
                </Button>,
                <Button
                  key="room"
                  type="link"
                  onClick={() => handleCreateRoom(project.id)}
                >
                  Collab Room
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={project.name}
                description={`Created ${dayjs(project.createdAt).format('YYYY-MM-DD HH:mm')} · Duration: ${Math.round(project.duration)}s`}
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
};
