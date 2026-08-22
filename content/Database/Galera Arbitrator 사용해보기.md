---
title: Galera Arbitrator 컨테이너 생성 & failover 테스트
date: 2024-10-10
draft: false
tags:
  - mariadb
  - galera
banner: 
cssclasses: 
description: 
permalink: 
aliases:
completed:
---

## 1. 환경
- mariadb 10.8.3 (bitnami/mariadb-galera:10.8.3-debian-11-r0)
- galera 26.22

## 2. 이슈
Galera Cluster 가 Failover 를 처리하기 위해서는 최소 3개의 노드가 필요하다. 하지만 불가피하게 2개 노드에서 Galera Cluster 를 이용해야 하는 상황이 생겨 Galera Arbitrator 를 활용하는 방법을 알아보았다.  
Galera Cluster 는 클러스터 분산이 이루어지면 Quorum 알고리즘을 이용해 Primary 클러스터와 non-Primary 클러스터 섹션을 구분하는데, Quorum 알고리즘에는 일반 노드가 아닌 Galera Arbitrator(이하 garbd) 노드도 참여할 수 있다고 한다.  

## 3. 해결
### 1. garbd 컨테이너 이미지 생성
garbd 공식 컨테이너 이미지는 없기 때문에 이미지 생성이 필요했다. 기존 mariadb 컨테이너와 별도로 준비해도 되겠지만 굳이 분리할 필요가 없다면 하나의 이미지로 통합한 뒤 command 로 일반 galera node 와 garbd 노드를 구분하는 방법을 택했다.  
현재 클러스터 버전과 일치하는 garbd 를 설치하기 위해 [mariadb 공식 문서](https://mariadb.com/kb/en/meta/galera-versions/)를 확인해봤지만 정확히 일치하는 버전은 없었다. 다만 galera major 버전이 26인 경우 galera-arbitrator-4 를 설치하는 것이 맞을 것으로 판단되어 아래와 같이 Dockerfile 내용을 추가했다.  

```dockerfile
RUN apt update --fix-missing && apt -y upgrade
RUN apt install -y --no-install-recommends software-properties-common &&\
    apt-add-repository 'deb https://releases.galeracluster.com/galera-4/ubuntu focal main' &&\
    apt install -y --no-install-recommends galera-arbitrator-4
```

향후 `https://releases.galeracluster.com/galera-4/ubuntu` 리포가 항상 존재할지와 상위 버전이 계속해서 현재 Galera Cluster 를 지원할지는 고민되는 부분이지만, 나중에 고민하기로 했다.  

> [!NOTE] 
> galera-arbitrator-3 을 설치하면 아래와 같은 오류가 발생한다.  
> 2024-10-10 13:01:02.729 FATAL: ./gcs/src/gcs_group.cpp:group_check_proto_ver():258: Group requested gcs_proto_ver: 2, max supported by this node: 0.Upgrade the node before joining this group.Need to abort.
2024-10-10 13:01:02.729  INFO: garbd: Terminated.
> 

### 2. garbd 옵션 설정
[갈레라 공식문서](https://galeracluster.com/library/documentation/arbitrator.html)를 확인해보면 옵션을 직접 command 에 추가해주는 방법과 config 파일을 이용하는 방법이 있었다.  

#### command 방식

```yaml
# docker-compose.yml
 command:
 - garbd
 - --name=garbd-test-2
 - --group=my_galera
 - --address=gcomm://172.45.0.2:34567,172.45.0.3:34567
 - --log=/var/log/mysql/garbd.log
 - --options="base_dir=/bitnami/mariadb"
```

#### config 방식

```yaml
# docker-compose.yml
command: garbd -c /path/to/arbitrator.config
```

```bash
# arbitrator.config
name=garbd-test-2
group=my_galera
address=gcomm://172.45.0.2:34567,172.45.0.3:34567
log=/var/log/mysql/garbd.log
options="base_dir=/bitnami/mariadb"
```

### 3. failover 확인
garbd 노드가 정상적으로 실행되면 wsrep_cluster_size 가 1 증가하고 클러스터에 정상적으로 join 한 것으로 보인다. 하지만 이 정도로는 garbd 가 정상적으로 동작하는지 판단하기 어렵다. 그렇기 때문에 인위적으로 장애를 발생시키고 garbd 노드의 유무에 따른 failover 처리 여부를 파악했다.   

#### 테스트 방식
galera 노드와 garbd 노드 모두 도커 컨테이너로 구성되어 있기 때문에 물리적으로 네트워크를 단절시키기는 어렵다. 그래서 `docker network disconnect` 명령어를 사용해 노드 간 네트워크를 단절시켰다. 그러면 각 노드가 계속 실행 중이지만 서로 통신할 수 없는 상태(split)가 발생한다.  

```bash
# 네트워크 단절
docker network disconnect garbd-test_galera-net garbd-test-0
# 정상화
docker network connect garbd-test_galera-net garbd-test-0
```

> [!NOTE]
> docker stop 으로 컨테이너를 정상 종료할 경우 노드가 1개만 남더라도 트랜젝션이 정상적으로 동작한다.


#### 케이스1 - galera 노드 2, garbd 노드 1

클러스터를 init 한 직후의 클러스터 사이즈와 상태는 다음과 같다.  

```sql
MariaDB [(none)]> SHOW STATUS LIKE 'wsrep_cluster_size';
+--------------------+-------+
| Variable_name      | Value |
+--------------------+-------+
| wsrep_cluster_size | 3     |
+--------------------+-------+

MariaDB [(none)]> SHOW STATUS LIKE 'wsrep_cluster_status';
+----------------------+---------+
| Variable_name        | Value   |
+----------------------+---------+
| wsrep_cluster_status | Primary |
+----------------------+---------+
```

이 상태에서 0번 노드(galera 노드)의 네트워크를 단절시킨다.  

```bash
docker network disconnect garbd-test_galera-net garbd-test-0
```

1번 노드에서 확인해보면 0번 노드가 분리되어 클러스터 사이즈가 줄었음에도 Primary 섹션임을 확인할 수 있다.  

```sql
MariaDB [(none)]> SHOW STATUS LIKE 'wsrep_cluster_size';
+--------------------+-------+
| Variable_name      | Value |
+--------------------+-------+
| wsrep_cluster_size | 2     |
+--------------------+-------+

MariaDB [(none)]> SHOW STATUS LIKE 'wsrep_cluster_status';
+----------------------+---------+
| Variable_name        | Value   |
+----------------------+---------+
| wsrep_cluster_status | Primary |
+----------------------+---------+
```

따라서 트랜젝션 처리가 정상적으로 가능하다.  

```sql
MariaDB [(none)]> create database test4;
Query OK, 1 row affected (0.017 sec)
```

#### 케이스2 - galera 노드 2, garbd 노드 0

클러스터를 init 한 직후의 클러스터 사이즈와 상태는 다음과 같다.  

```sql
MariaDB [(none)]> SHOW STATUS LIKE 'wsrep_cluster_size';
+--------------------+-------+
| Variable_name      | Value |
+--------------------+-------+
| wsrep_cluster_size | 2     |
+--------------------+-------+

MariaDB [(none)]> SHOW STATUS LIKE 'wsrep_cluster_status';
+----------------------+---------+
| Variable_name        | Value   |
+----------------------+---------+
| wsrep_cluster_status | Primary |
+----------------------+---------+
```

이 상태에서 0번 노드(galera 노드)의 네트워크를 단절시킨다.  

```bash
docker network disconnect garbd-test_galera-net garbd-test-0
```

1번 노드에서 확인해보면 0번 노드가 분리되어 클러스터 사이즈가 줄었고 non-Primary 섹션임을 확인할 수 있다(split brain).   

```sql
MariaDB [(none)]> SHOW STATUS LIKE 'wsrep_cluster_size';
+--------------------+-------+
| Variable_name      | Value |
+--------------------+-------+
| wsrep_cluster_size | 1     |
+--------------------+-------+

MariaDB [(none)]> SHOW STATUS LIKE 'wsrep_cluster_status';
+----------------------+-------------+
| Variable_name        | Value       |
+----------------------+-------------+
| wsrep_cluster_status | non-Primary |
+----------------------+-------------+
```

이후 트랜젝션 처리에 오류가 발생함을 확인할 수 있다.  

```sql
MariaDB [(none)]> create database test3;
ERROR 1205 (HY000): Lock wait timeout exceeded; try restarting transaction
```

## 4. 전체 스크립트
### docker-compose.yml
```yaml
networks:
  galera-net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.45.0.0/24

services:
  garbd-test-0:
    container_name: garbd-test-0
    environment:
      MARIADB_GALERA_CLUSTER_BOOTSTRAP: "yes"
      MARIADB_GALERA_CLUSTER_NAME: my_galera
      MARIADB_GALERA_FORCE_SAFETOBOOTSTRAP: "yes"
      MARIADB_GALERA_MARIABACKUP_PASSWORD: '1234'
      MARIADB_GALERA_MARIABACKUP_USER: user1
      MARIADB_ROOT_PASSWORD: 1234
    hostname: garbd-test-0
    image: db-with-garbd/app:3.1
    ports:
    - 33123:3306
    volumes:
    - /etc/hosts:/etc/hosts:ro
    - /etc/localtime:/etc/localtime:ro
    - ./config/0:/opt/bitnami/mariadb/conf/bitnami:rw
    - ./log/0:/var/log/mysql:rw
    - ./data/0:/bitnami/mariadb:rw
    networks:
      galera-net:
        ipv4_address: 172.45.0.2

  garbd-test-1:
    container_name: garbd-test-1
    environment:
      MARIADB_GALERA_CLUSTER_BOOTSTRAP: "yes"
      MARIADB_GALERA_CLUSTER_NAME: my_galera
      MARIADB_GALERA_FORCE_SAFETOBOOTSTRAP: "yes"
      MARIADB_GALERA_MARIABACKUP_PASSWORD: '1234'
      MARIADB_GALERA_MARIABACKUP_USER: user1
      MARIADB_ROOT_PASSWORD: 1234
    hostname: garbd-test-1
    image: db-with-garbd/app:3.1
    volumes:
    - /etc/hosts:/etc/hosts:ro
    - /etc/localtime:/etc/localtime:ro
    - ./config/1:/opt/bitnami/mariadb/conf/bitnami:rw
    - ./log/1:/var/log/mysql:rw
    - ./data/1:/bitnami/mariadb:rw
    networks:
      galera-net:
        ipv4_address: 172.45.0.3

  garbd-test-2:
    container_name: garbd-test-2
    environment:
      MARIADB_GALERA_CLUSTER_NAME: my_galera
    hostname: garbd-test-2
    image: db-with-garbd/app:3.1
    volumes:
    - /etc/hosts:/etc/hosts:ro
    - /etc/localtime:/etc/localtime:ro
    - ./config/2:/opt/bitnami/mariadb/conf/bitnami:rw
    - ./log/2:/var/log/mysql:rw
    - ./data/2:/bitnami/mariadb:rw
    command: garbd -c /opt/bitnami/mariadb/conf/bitnami/arbitrator.config

    networks:
      galera-net:
        ipv4_address: 172.45.0.4
```

###  Dockerfile
```dockerfile
FROM bitnami/mariadb-galera:10.8.3-debian-11-r0

USER root

# 필요 패키지 설치
RUN apt update --fix-missing && apt -y upgrade
RUN apt install -y --no-install-recommends apt-utils sudo vim git procps wget curl net-tools rsync progress screen zsh locales software-properties-common && \
    apt-add-repository 'deb https://releases.galeracluster.com/galera-4/ubuntu focal main' &&\
    apt install -y --no-install-recommends galera-arbitrator-4 &&\
    apt autoremove -y && apt autoclean -y && \
    rm -rf /var/lib/apt/lists/* && \
    localedef -f UTF-8 -i ko_KR ko_KR.UTF-8

# 환경변수 설정
ENV LANGUAGE ko_KR.UTF-8
ENV LANG ko_KR.UTF-8
ENV TZ "Asia/Seoul"

# alias 설정 추가
RUN echo "alias ll='ls -alFh'" >> /etc/bash.bashrc && \
    echo "alias vi='vim'" >> /etc/bash.bashrc && \
    echo "alias grep='grep --color=auto'" >> /etc/bash.bashrc

RUN useradd -ms /bin/bash mysql
```

### config
```bash
# node0 - my_custom.cfg
[galera]
wsrep_cluster_address     = "gcomm://"
wsrep_node_address        = "172.45.0.2:34567"
wsrep_node_name           = garbd-test-0
wsrep_sst_auth            = user1:1234
wsrep_sst_method          = mariabackup
wsrep_sst_receive_address = "172.45.0.2:34566"
wsrep_provider_options    = "base_port=34567;ist.recv_addr=172.45.0.2:34568;gcache.recover=yes"
```

```bash
# node1 - my_custom.cfg
[galera]
wsrep_cluster_address     = "gcomm://172.45.0.2:34567"
wsrep_node_address        = "172.45.0.3:34567"
wsrep_node_name           = garbd-test-1
wsrep_sst_auth            = user1:1234
wsrep_sst_method          = mariabackup
wsrep_sst_receive_address = "172.45.0.3:34566"
wsrep_provider_options    = "base_port=34567;ist.recv_addr=172.45.0.3:34568;gcache.recover=yes"
```

```bash
# node2 - arbitrator.config
name=garbd-test-2
group=my_galera
address=gcomm://172.45.0.2:34567,172.45.0.3:34567
log=/var/log/mysql/garbd.log
options="base_dir=/bitnami/mariadb"
```

## 참고
- [https://galeracluster.com/library/documentation/weighted-quorum.html](https://galeracluster.com/library/documentation/weighted-quorum.html)
- [https://github.com/panubo/docker-mariadb-galera/blob/master/10.2/Dockerfile](https://github.com/panubo/docker-mariadb-galera/blob/master/10.2/Dockerfile)



