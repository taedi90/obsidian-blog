---
title: "fluentd 로그\b병합 & 필터링"
date: 2023-02-02
draft: false
tags:
  - logging
banner: 
cssclasses: 
description: fluentd로 도커 로그를 수집할 때 로그가 분리되는 현상을 수정하고 그 중 필요한 로그만 선별하는 방법을 알아본다.
permalink: 
aliases: 
completed:
---
## 요약

- 로그 합치기는 ‘fluent-plugin-concat’ 플러그인 사용
- 로그 예외처리는 ‘grep’ 플러그인 사용

  

## 이슈

쿠버네티스 클러스터에 EFK 스택을 도입하여 파드 내부에서 생성되는 모든 로그를 엘라스틱서치에 저장했더니 다음 이슈가 발생했다.

- 방대한 로그 데이터로 스토리지 및 ES 부하 발생
- 여러줄로 이뤄진 로그를 각 줄마다 별개의 ES 도큐먼트로 저장하는 문제

처음 도입할 때부터 인지했던 부분이지만 시간을 핑계로 특정 파드에서 생성되는 로그만 수집하는 정도로만 설정을 해뒀으나 역부족이었고 추가 대응이 필요했다.

  

## 해결

### 사전 준비

우선적으로 어떤 로그를 남길 것인지에 대한 합의가 필요했고, 작업이 수월하게 진행되기 위해 로그 포맷을 지정이 필요했다.

결과적으로 모든 로그에 대해서 로그 레벨 표시를 ‘[INFO]’, ‘[ WARN ]’, ‘[ERROR ]’ 와 같이 대괄호에 감싸진 대문자로 표기하도록 애플리케이션을 수정하고 그중 INFO, WARN, ERROR 레벨만 수집하기로 결정되었다.

  

### 여러줄 로그 합병하기

검색해보니 몇가지 방법이 있었는데 그 중 ‘fluent-plugin-concat’ 을 사용했다. 정규식을 통해서 합병할 로그의 시작과 끝을 지정할 수 있는 것이 맘에 들었고, 회사에서 개발중인 프로젝트들이 꽤나 규칙성있는 로그를 출력하고 있는 것 또한 플러그인과 잘 어울리는 듯 했다.

```bash
## 멀티라인 로그 합병(concat)
<filter **>
  @type concat
  key log
  multiline_start_regexp /\[\s*(INFO|WARN|ERROR)\s*\]/
  continuous_line_regexp /^((?!\[\s*INFO\s*\]|\[\s*ERROR\s*\]|\[\s*WARN\s*\]|\[\s*DEBUG\s*\]|\[\s*FATAL\s*\]).)*$/
  separator ""
  \#flush_interval 10
</filter>
```

fluent-plugin-concat 플러그인을 사용하기 위해서는 플러그인 설치가 필요하다.

```bash
gem install fluent-plugin-concat
```

  

### INFO, WARN, ERROR 로그만 남기기

grep 필터를 사용하면 정규식을 만족하는 로그를 모두 예외처리할 수 있다.

```bash
## info/warn/error 레벨 로그만 수집
<filter **>
  @type grep
  <regexp>
    key log
    pattern /\[\s*(INFO|WARN|ERROR)\s*\]/
  </regexp>
</filter>
```

  

## 참고

- [https://github.com/fluent-plugins-nursery/fluent-plugin-concat](https://github.com/fluent-plugins-nursery/fluent-plugin-concat)
- [https://docs.fluentd.org/input/tail](https://docs.fluentd.org/input/tail)