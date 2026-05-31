import React, { memo } from 'react';
import { Avatar, Badge, List } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { useRoomStore } from '../../stores/room-store';

export const ParticipantList: React.FC = memo(() => {
  const participants = useRoomStore((s) => s.participants);

  return (
    <div className="participant-list">
      <h4 className="participant-list__title">Participants ({participants.length})</h4>
      <List
        size="small"
        dataSource={participants}
        renderItem={(participant) => (
          <List.Item className="participant-list__item">
            <List.Item.Meta
              avatar={
                <Badge
                  status={participant.isOnline ? 'success' : 'default'}
                  offset={[-4, 28]}
                >
                  <Avatar
                    size="small"
                    style={{ backgroundColor: participant.color }}
                    icon={<UserOutlined />}
                  />
                </Badge>
              }
              title={
                <span style={{ color: participant.isOnline ? undefined : '#999' }}>
                  {participant.name}
                </span>
              }
            />
          </List.Item>
        )}
      />
    </div>
  );
});

ParticipantList.displayName = 'ParticipantList';
