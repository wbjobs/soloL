use std::collections::HashSet;
use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV4, SocketAddrV6, ToSocketAddrs};
use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::Bytes;
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use log::debug;

#[derive(Debug, Error)]
pub enum NetworkError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("Invalid address: {0}")]
    InvalidAddress(String),
    #[error("Unsupported address family")]
    UnsupportedFamily,
    #[error("IPv6 not available")]
    Ipv6NotAvailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressFamily {
    Ipv4Only,
    Ipv6Only,
    DualStack,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpVersionPreference {
    Ipv4First,
    Ipv6First,
    Auto,
}

#[derive(Debug, Clone)]
pub struct DualStackConfig {
    pub address_family: AddressFamily,
    pub preference: IpVersionPreference,
    pub ipv6_only: bool,
    pub reuse_address: bool,
    pub reuse_port: bool,
    pub backlog: u32,
}

impl Default for DualStackConfig {
    fn default() -> Self {
        Self {
            address_family: AddressFamily::DualStack,
            preference: IpVersionPreference::Auto,
            ipv6_only: false,
            reuse_address: true,
            reuse_port: true,
            backlog: 1024,
        }
    }
}

pub fn is_ipv4_mapped(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().is_some(),
        IpAddr::V4(_) => false,
    }
}

pub fn to_ipv4_mapped(v4: &Ipv4Addr) -> Ipv6Addr {
    v4.to_ipv6_mapped()
}

pub fn to_ipv6_if_mapped(addr: SocketAddr) -> SocketAddr {
    match addr {
        SocketAddr::V4(v4) => SocketAddr::V6(SocketAddrV6::new(
            v4.ip().to_ipv6_mapped(),
            v4.port(),
            0,
            0,
        )),
        SocketAddr::V6(_) => addr,
    }
}

pub fn get_preferred_addr(
    addrs: &[SocketAddr],
    preference: IpVersionPreference,
) -> Option<SocketAddr> {
    if addrs.is_empty() {
        return None;
    }

    let has_ipv4 = addrs.iter().any(|a| a.is_ipv4());
    let has_ipv6 = addrs.iter().any(|a| a.is_ipv6());

    let pref = match preference {
        IpVersionPreference::Ipv4First => {
            if has_ipv4 {
                IpVersionPreference::Ipv4First
            } else {
                IpVersionPreference::Ipv6First
            }
        }
        IpVersionPreference::Ipv6First => {
            if has_ipv6 {
                IpVersionPreference::Ipv6First
            } else {
                IpVersionPreference::Ipv4First
            }
        }
        IpVersionPreference::Auto => {
            if has_ipv6 && has_ipv4 {
                IpVersionPreference::Ipv6First
            } else if has_ipv6 {
                IpVersionPreference::Ipv6First
            } else {
                IpVersionPreference::Ipv4First
            }
        }
    };

    match pref {
        IpVersionPreference::Ipv4First => addrs.iter().find(|a| a.is_ipv4()).copied(),
        IpVersionPreference::Ipv6First => addrs.iter().find(|a| a.is_ipv6()).copied(),
        _ => addrs.first().copied(),
    }
}

pub fn parse_bind_address(
    addr: &str,
    config: &DualStackConfig,
) -> Result<Vec<SocketAddr>, NetworkError> {
    let mut parsed: Vec<SocketAddr> = addr
        .to_socket_addrs()?
        .collect();

    match config.address_family {
        AddressFamily::Ipv4Only => {
            parsed.retain(|a| a.is_ipv4());
        }
        AddressFamily::Ipv6Only => {
            parsed.retain(|a| a.is_ipv6());
        }
        AddressFamily::DualStack => {}
    }

    if parsed.is_empty() {
        return Err(NetworkError::InvalidAddress(format!(
            "No valid addresses found for '{}' with {:?}",
            addr, config.address_family
        )));
    }

    Ok(parsed)
}

pub fn get_local_addresses() -> Result<HashSet<IpAddr>, NetworkError> {
    let mut addrs = HashSet::new();

    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "localhost".to_string());

    if let Ok(socket_addrs) = format!("{}:0", hostname).to_socket_addrs() {
        for addr in socket_addrs {
            let ip = addr.ip();
            match ip {
                IpAddr::V4(v4) => {
                    if !v4.is_loopback() && !v4.is_link_local() {
                        addrs.insert(ip);
                    }
                }
                IpAddr::V6(v6) => {
                    if !v6.is_loopback() && !v6.is_unicast_link_local() {
                        addrs.insert(ip);
                    }
                }
            }
        }
    }

    addrs.insert(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)));
    addrs.insert(IpAddr::V6(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0, 1)));

    Ok(addrs)
}

pub struct DualStackSocket {
    pub socket: UdpSocket,
    pub config: DualStackConfig,
}

impl DualStackSocket {
    pub async fn bind(addr: SocketAddr, config: DualStackConfig) -> Result<Self, NetworkError> {
        let socket = match addr {
            SocketAddr::V4(_) => UdpSocket::bind(addr).await?,
            SocketAddr::V6(_) => {
                let socket = UdpSocket::bind(addr).await?;
                #[cfg(unix)]
                {
                    use socket2::{Domain, Protocol, Socket as Sock2Socket, Type};
                    let std_socket = socket.into_std()?;
                    let sock2 = Sock2Socket::from(std_socket);
                    sock2.set_only_v6(config.ipv6_only)?;
                    let std_socket = std::net::UdpSocket::from(sock2);
                    UdpSocket::from_std(std_socket)?
                }
                #[cfg(not(unix))]
                {
                    socket
                }
            }
        };

        Ok(Self { socket, config })
    }

    pub async fn bind_dual_stack(
        port: u16,
        config: DualStackConfig,
    ) -> Result<Self, NetworkError> {
        let addr = SocketAddr::V6(SocketAddrV6::new(
            Ipv6Addr::UNSPECIFIED,
            port,
            0,
            0,
        ));
        Self::bind(addr, config).await
    }

    pub async fn send_to(&self, buf: &[u8], target: SocketAddr) -> Result<usize, NetworkError> {
        let target = match self.socket.local_addr()? {
            SocketAddr::V6(_) => to_ipv6_if_mapped(target),
            _ => target,
        };
        Ok(self.socket.send_to(buf, target).await?)
    }

    pub async fn recv_from(&self, buf: &mut [u8]) -> Result<(usize, SocketAddr), NetworkError> {
        Ok(self.socket.recv_from(buf).await?)
    }

    pub fn local_addr(&self) -> Result<SocketAddr, NetworkError> {
        Ok(self.socket.local_addr()?)
    }
}

pub struct DualStackListener {
    listener: TcpListener,
    config: DualStackConfig,
}

impl DualStackListener {
    pub async fn bind(addr: SocketAddr, config: DualStackConfig) -> Result<Self, NetworkError> {
        let listener = TcpListener::bind(addr).await?;
        Ok(Self { listener, config })
    }

    pub async fn bind_dual_stack(
        port: u16,
        config: DualStackConfig,
    ) -> Result<Self, NetworkError> {
        let addr = SocketAddr::V6(SocketAddrV6::new(
            Ipv6Addr::UNSPECIFIED,
            port,
            0,
            0,
        ));
        Self::bind(addr, config).await
    }

    pub async fn accept(&self) -> Result<(DualStackStream, SocketAddr), NetworkError> {
        let (stream, addr) = self.listener.accept().await?;
        Ok((DualStackStream { stream }, addr))
    }

    pub fn local_addr(&self) -> Result<SocketAddr, NetworkError> {
        Ok(self.listener.local_addr()?)
    }
}

pub struct DualStackStream {
    stream: TcpStream,
}

impl DualStackStream {
    pub async fn connect(addr: SocketAddr) -> Result<Self, NetworkError> {
        Ok(Self {
            stream: TcpStream::connect(addr).await?,
        })
    }

    pub async fn connect_with_preference(
        addrs: &[SocketAddr],
        preference: IpVersionPreference,
    ) -> Result<Self, NetworkError> {
        let pref = get_preferred_addr(addrs, preference)
            .ok_or(NetworkError::InvalidAddress("No addresses".into()))?;

        Self::connect(pref).await
    }

    pub fn local_addr(&self) -> Result<SocketAddr, NetworkError> {
        Ok(self.stream.local_addr()?)
    }

    pub fn peer_addr(&self) -> Result<SocketAddr, NetworkError> {
        Ok(self.stream.peer_addr()?)
    }

    pub async fn write_all(&self, buf: &[u8]) -> Result<(), NetworkError> {
        self.stream.writable().await?;
        self.stream.try_write(buf)?;
        Ok(())
    }

    pub async fn read(&self, buf: &mut [u8]) -> Result<usize, NetworkError> {
        self.stream.readable().await?;
        Ok(self.stream.try_read(buf)?)
    }
}

impl AsyncRead for DualStackStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_read(cx, buf)
    }
}

impl AsyncWrite for DualStackStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.stream).poll_write(cx, buf)
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(cx)
    }

    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ipv4_mapped() {
        let v4 = Ipv4Addr::new(192, 168, 1, 1);
        let mapped = to_ipv4_mapped(&v4);
        assert!(mapped.to_ipv4_mapped().is_some());
        assert_eq!(mapped.to_ipv4_mapped().unwrap(), v4);
    }

    #[test]
    fn test_get_preferred_addr() {
        let addrs = vec![
            SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 8080)),
            SocketAddr::V6(SocketAddrV6::new(Ipv6Addr::LOCALHOST, 8080, 0, 0)),
        ];

        assert!(get_preferred_addr(&addrs, IpVersionPreference::Ipv4First)
            .unwrap()
            .is_ipv4());
        assert!(get_preferred_addr(&addrs, IpVersionPreference::Ipv6First)
            .unwrap()
            .is_ipv6());
    }

    #[test]
    fn test_to_ipv6_if_mapped() {
        let v4_addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::new(10, 0, 0, 1), 1234));
        let v6_addr = to_ipv6_if_mapped(v4_addr);
        assert!(v6_addr.is_ipv6());
        if let SocketAddr::V6(v6) = v6_addr {
            assert_eq!(v6.port(), 1234);
            assert!(v6.ip().to_ipv4_mapped().is_some());
        }
    }
}
