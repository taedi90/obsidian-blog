---
title: Elasticsearch
date: 2024-09-05
draft: true
tags:
banner:
cssclasses:
description:
permalink:
aliases:
completed:
---
# 1. 개념

## 1-1. ElasticSearch vs RDBMS

  

역인덱스!, mapping, aggregations

  

역색인

그럼 느려지는건 아닌가..

관계형 데이터베이스

## 1-2. Pros & Cons

### 장점

- 동의어, 유의어 활용  
    비정형 데이터 색인과 검색 가능  
    (빅데이터 처리에서 중요시 되는 부분)  
    
- 형태소 분석을 통한 자연어 처리  
    (형태소 관련 플러그인 제공)  
    
- 역색인 지원

### 단점

  

## 1-3. 구조

|Elastic|≃ RDB|Description|
|---|---|---|
|cluster||가장 큰 시스템 단위이자 node 들의 집합|
|node||단위 프로세스, 역할에 따라 master data ingest 등으로 구분|
|shard||데이터 분산 저장|
|type|table|(deprecated) ≤ 7.0.0  <br>  <br>[https://www.elastic.co/guide/en/elasticsearch/reference/current/removal-of-types.html](https://www.elastic.co/guide/en/elasticsearch/reference/current/removal-of-types.html)|
|index(indices)|database||
|document|row||

node: master node, data node

클러스터는 1개 이상의 노드로 이루어 진다.

하나의 노드는 인덱스의 메타 데이터, 샤드의 위치와 같은 클러스터 상태(Cluster Status) 정보를 관리하는 **마스터 노드**의 역할을 수행

  

클러스터 성능 측면 → 데이터 노드와 마스터&후보 노드의 분리

node.master

node.data

  

master-eligible node: 실제 운영 서버에서는 마스터 후보를 3개 이상의 홀수개로 설정해야함(split brain)

네트워크 단절로 인한 클러스터 분리

  

data node: 실제로 색인된 데이터를 저장하고 있는 노드

  

  

## cluster

groups of nodes

data loss 방지

  

- [https://www.elastic.co/guide/en/elasticsearch/reference/current/add-elasticsearch-nodes.html](https://www.elastic.co/guide/en/elasticsearch/reference/current/add-elasticsearch-nodes.html)

  

The cluster is fully functional but is at risk of data loss in the event of a failure.

  

  

## 1-3. License

- [https://www.elastic.co/kr/subscriptions](https://www.elastic.co/kr/subscriptions)

  

# 2. Docker 환경에서 설치

도커 환경에서 설치, es 세개 노드

## 2-1. Docker-compose.yml

- [https://www.elastic.co/guide/en/elasticsearch/reference/7.17/docker.html](https://www.elastic.co/guide/en/elasticsearch/reference/7.17/docker.html)

```YAML
version: "3"
services:
  es01:
    image: docker.elastic.co/elasticsearch/elasticsearch:7.17.0
    container_name: es01
    environment:
      - node.name=es01
      - cluster.name=es-docker-cluster
      - discovery.seed_hosts=es02,es03
      - cluster.initial_master_nodes=es01,es02,es03
      - bootstrap.memory_lock=true
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    ulimits:
      memlock:
        soft: -1
        hard: -1
    volumes:
      - data01:/usr/share/elasticsearch/data
    ports:
      - 49905:9200
    networks:
      - elastic
  es02:
    image: docker.elastic.co/elasticsearch/elasticsearch:7.17.0
    container_name: es02
    environment:
      - node.name=es02
      - cluster.name=es-docker-cluster
      - discovery.seed_hosts=es01,es03
      - cluster.initial_master_nodes=es01,es02,es03
      - bootstrap.memory_lock=true
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    ulimits:
      memlock:
        soft: -1
        hard: -1
    volumes:
      - data02:/usr/share/elasticsearch/data
    networks:
      - elastic
  es03:
    image: docker.elastic.co/elasticsearch/elasticsearch:7.17.0
    container_name: es03
    environment:
      - node.name=es03
      - cluster.name=es-docker-cluster
      - discovery.seed_hosts=es01,es02
      - cluster.initial_master_nodes=es01,es02,es03
      - bootstrap.memory_lock=true
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    ulimits:
      memlock:
        soft: -1
        hard: -1
    volumes:
      - data03:/usr/share/elasticsearch/data
    networks:
      - elastic

  kib01:
    image: docker.elastic.co/kibana/kibana:7.17.0
    container_name: kib01
    ports:
      - 49906:5601
    environment:
      ELASTICSEARCH_URL: http://es01:9200
      ELASTICSEARCH_HOSTS: http://es01:9200
    networks:
      - elastic
    depends_on:
      - es01

volumes:
  data01:
    driver: local
  data02:
    driver: local
  data03:
    driver: local

networks:
  elastic:
    driver: bridge
```

  

## ⛔️ 설치 오류

### 🙅🏻 **[1] bootstrap checks failed**

> ERROR: [1] bootstrap checks failed  
> [1]: max virtual memory areas vm.max_map_count [65530] is too low, increase to at least [262144]  

운영체제에 설정 된 vm.max_map_count 가 낮게 잡혀서 발생한 문제

→ sudo sysctl -w vm.max_map_count=262144 (리눅스 기준)

  

- [https://www.elastic.co/guide/en/elasticsearch/reference/7.17/docker.html#docker-compose-file](https://www.elastic.co/guide/en/elasticsearch/reference/7.17/docker.html#docker-compose-file)
- [https://antdev.tistory.com/63](https://antdev.tistory.com/63)

  

### 🙅🏻 Kibana server is not ready yet

kibana 로그 확인 해봤을 때 아래 와 같은 오류가 발생

> Unable to retrieve version information from Elasticsearch nodes. connect ECONNREFUSED 127.0.0.1:49905”

→ 네트워크 설정 누락 또는 포트번호 오입력 확인

  

## 2-2. 설치 확인

```Bash
curl -X GET "localhost:49905/_cat/nodes?v=true&pretty”
```

  

## 2-3. 키바나 콘솔

Menu > Management > Dev Tools

  

## 2-4. odfesql

  

  

  

  

# 3. 사용

## CRUD

### create

```JavaScript
PUT ts_index/_doc/1
{
  "name": "test",
  "message": "테스트 메세지 입니다."
}
```

### read

```JavaScript
GET ts_index/_doc/1
```

### update

```JavaScript
PUT ts_index/_doc/1
{
    "name": "modified1",
    "message": "수정되었습니다."
}
```

→ 위 방식은 기존에 document가 없으면 생성됨 (200, ok)

```JavaScript
POST ts_index/_update/1
{
  "doc": {
      "name": "modified2",
      "message": "다시 수정되었습니다."
  }
}
```

→ 위 방식은 기존에 document가 없으면 404 오류 발생

### delete

```JavaScript
DELETE ts_index/_doc/1
```

  

  

```JavaScript
GET dbins_winback_chatbot_v2_faq_log/_search
GET dbins_winback_chatbot_v2_counsel/_mapping
GET dbins_winback_chatbot_v2_counsel/_search
{
  "size": 0, 
  "query": {
    "bool": {
      "must": [
        {
          "term": {
            "channel_code.keyword": {
              "value": "DEFAULT"
            }
          }
        }
      ]
    }
  },
  "aggs": {
    "test_aggs": {
      "date_histogram": {
        "field": "created",
        "interval": "day"
      }
    }
  }
}


GET _cat/indices?v
GET _cat/indices?v
GET _cat/shards?v

PUT ts_index/_doc/1
{
  "name": "test",
  "message": "테스트 메세지 입니다."
}

GET ts_index

POST ts_index/_doc/
{
    "name": "modified",
    "message": "수정되었습니다."
}

PUT ts_index/_doc/1
{
    "name": "modified",
    "message": "수정되었습니다."
}

POST ts_index/_update/1
{
  "doc": {
      "name": "modified",
      "message": "수정되었습니다."
  }
}

DELETE ts_index/_doc/1

GET ts_index/_search
{
  "query": {
    "bool": {
      "should": [
        {
          "match": {
            "message": "테스트"
          }
        },
        {
          "match": {
            "name": "modified"
          }
        }
      ]
    }
  }
}

GET _cat/indices?v
GET _cat/health?v
GET _cat/nodes?v
GET _cat/
```

  

  

## 콘솔 단축키

> **Ctrl/Cmd + I**
> 
> Auto indent current request.
> 
>   
> 
> **Ctrl + Space**
> 
> Open Autocomplete (even if not typing).
> 
>   
> 
> **Ctrl/Cmd + Enter**
> 
> Submit request.
> 
>   
> 
> **Ctrl/Cmd + Up/Down**
> 
> Jump to the previous/next request start or end.
> 
>   
> 
> **Ctrl/Cmd + Alt + L**
> 
> Collapse/expand current scope.
> 
>   
> 
> **Ctrl/Cmd + Option + 0**
> 
> Collapse all scopes but the current one. Expand by adding a shift.

  

- 출처: [https://www.elastic.co/guide/en/kibana/6.8/keyboard-shortcuts.html](https://www.elastic.co/guide/en/kibana/6.8/keyboard-shortcuts.html)

  

# 참고

- [https://victorydntmd.tistory.com/308](https://victorydntmd.tistory.com/308)
- [https://neulpeumbomin.tistory.com/19](https://neulpeumbomin.tistory.com/19)
- [https://blog.yeom.me/2018/03/24/get-started-elasticsearch/](https://blog.yeom.me/2018/03/24/get-started-elasticsearch/)
- [https://velog.io/@jakeseo_me/엘라스틱서치-알아보기-2-DB만-있으면-되는데-왜-굳이-검색엔진](https://velog.io/@jakeseo_me/%EC%97%98%EB%9D%BC%EC%8A%A4%ED%8B%B1%EC%84%9C%EC%B9%98-%EC%95%8C%EC%95%84%EB%B3%B4%EA%B8%B0-2-DB%EB%A7%8C-%EC%9E%88%EC%9C%BC%EB%A9%B4-%EB%90%98%EB%8A%94%EB%8D%B0-%EC%99%9C-%EA%B5%B3%EC%9D%B4-%EA%B2%80%EC%83%89%EC%97%94%EC%A7%84)