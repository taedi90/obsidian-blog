---
title: Ansible 기본 알아보기
date: 2025-04-09
draft: false
tags:
  - ansible
  - automation
  - infrastructure
  - configuration-management
  - devops
  - yaml
  - playbook
  - inventory
banner: 
cssclasses: 
description: Ansible을 처음 도입하면서 겪은 어려움과 폴더 구조, 변수 우선순위, 기본 사용법 정리.
permalink: 
aliases:
completed: 
type:
  - note
---

## 1. 개요

Ansible을 도입하면서 처음에 엄청 난항을 겪었다. 폴더 구조에 다양성을 둘 수 있고, 변수도 여러 곳에서 지정이 가능한 등 굉장히 자유도가 높고 기능이 많아서 어려웠다.

모든 내용을 다 파악하지는 못했고, 딱 쓸 만큼만 봤다. 나처럼 Ansible을 처음 붙잡고 헤매는 사람이 참고할 만한, 실무에서 바로 써먹는 기본만 추렸다.

## 2. 폴더 구조

폴더 구조는 완전히 정형적이라기보다는 꽤 자유도가 있었다. (제발 한 가지 방법만 되게 해주시면 안 됩니까? ㅋㅋㅋ) Ansible Best Practice와 Kubespray 구조, Ansible Galaxy에 공개된 코드들을 참고해서 틀을 정했다.

### 2-1. 최종 폴더 구성

```bash
/infra-automation/
│── .venv/             # Python 가상환경 (git으로 관리하지 않음)
│── inventory/         # 인벤토리 파일들
│   └── example
│       ├── group_vars/
│       └── inventory.yml
│── modules/           # 서브모듈 (Kubespray)
│   └── kubespray/
│── playbooks/         # 플레이북 파일들
│   └── kubernetes
│       ├── cluster.yml
│       └── upgrade_cluster.yml # snake_case
│── roles/             # Ansible 역할 (Roles)
│── ansible.cfg        # Ansible 설정 파일
...
│── Dockerfile
│── build-container.sh # kebab-case
│── requirements.txt   # Python 패키지 목록
└── README.md
```

### 2-2. 각 폴더 및 파일의 용도

- `.venv/`: Python 가상환경 디렉토리. Git에서 제외한다.
- `inventory/`: 대상 호스트 정보와 그룹별 변수를 정의한다.
  - `inventory.yml`: 호스트 목록과 그룹 정의
  - `group_vars/`: 그룹별 변수 파일
  - `host_vars/`: 호스트별 변수 파일
- `playbooks/`: 실행할 작업을 정의하는 플레이북
- `roles/`: 재사용 가능한 작업 단위를 담는 역할(Role) 디렉토리
- `modules/`: 외부 모듈이나 서브모듈 (예: Kubespray)
- `ansible.cfg`: Ansible 전역 설정 파일

### 2-3. 네이밍 컨벤션

Kubespray는 최근에 role과 task 폴더를 케밥케이스에서 스네이크케이스로 바꿔서 이유를 파악해보고 동일하게 적용했다.

- YAML 파일: `snake_case` (예: `upgrade_cluster.yml`)
- 쉘 스크립트: `kebab-case` (예: `build-container.sh`)
- 역할(Role) 이름: `snake_case` (예: `kubernetes_master`)

## 3. Ansible Galaxy

<b>Ansible Galaxy</b>는 Ansible 커뮤니티에서 제공하는 역할(Role) 저장소다. 미리 작성된 역할들을 검색하고 설치하여 사용할 수 있다.

### 3-1. 역할 검색 및 설치

```bash
# 역할 검색
ansible-galaxy search nginx

# 역할 설치
ansible-galaxy install geerlingguy.nginx

# requirements.yml을 통한 일괄 설치
ansible-galaxy install -r requirements.yml
```

### 3-2. requirements.yml 예시

```yaml
# requirements.yml
- name: geerlingguy.nginx
  version: "3.1.4"
- name: geerlingguy.mysql
  version: "4.3.4"
- src: https://github.com/custom/role.git
  name: custom_role
  version: main
```

## 4. 변수 우선순위

변수는 엄청 다양한 곳에서 정의가 가능하다. Ansible에서 변수가 적용되는 우선순위를 정확히 이해하는 것이 중요하다.

### 4-1. 변수 정의 예시

<b>1. 역할 기본값 (`roles/webserver/defaults/main.yml`)</b>
```yaml
nginx_port: 80
nginx_user: nginx
```

<b>2. 인벤토리 그룹 변수 (`group_vars/webservers.yml`)</b>
```yaml
nginx_port: 8080
ssl_enabled: true
```

<b>3. 인벤토리 호스트 변수 (`host_vars/web01.yml`)</b>
```yaml
nginx_port: 9080
server_name: web01.example.com
```

<b>4. 플레이북 내 변수</b>
```yaml
- hosts: webservers
  vars:
    nginx_port: 443
    ssl_cert_path: /etc/ssl/certs/
```

<b>5. 역할 변수 (`roles/webserver/vars/main.yml`)</b>
```yaml
nginx_port: 80
nginx_config_template: nginx.conf.j2
```

### 4-2. 변수 적용 순서 (낮은 순서 → 높은 순서)

1. <b>역할 기본값</b> (`role/defaults/main.yml`)
2. <b>인벤토리 그룹 변수</b> (`group_vars`, inventory 내 group)
3. <b>인벤토리 호스트 변수</b> (`host_vars`, inventory 내 host)
4. <b>플레이북 내 변수</b> (vars, vars_prompt, vars_files 등)
5. <b>역할 변수</b> (`role/vars/main.yml`)
6. <b>블록 변수, 태스크 변수, include_vars, set_fact</b>
7. <b>Extra-vars</b> (`-e` 옵션, 명령행 추가 변수) — 최고 우선순위

### 4-3. 변수 확인 명령어

변수가 어떻게 적용되는지 미리 확인할 수 있는 명령어들:

```bash
# 호스트별 변수 확인
ansible -i inventory/example/inventory.yml web01 -m debug -a "var=hostvars[inventory_hostname]"

# 특정 변수값 확인
ansible -i inventory/example/inventory.yml webservers -m debug -a "var=nginx_port"

# 모든 변수 확인 (상세)
ansible -i inventory/example/inventory.yml web01 -m setup

# 플레이북 실행 시 변수 확인 (Dry-run)
ansible-playbook -i inventory/example/inventory.yml playbooks/webserver.yml --check -v
```

## 5. Inventory 작성 예시

### 5-1. YAML 형식 인벤토리

```yaml
# inventory/production/inventory.yml
all:
  children:
    webservers:
      hosts:
        web01:
          ansible_host: 192.168.1.10
          ansible_user: ubuntu
        web02:
          ansible_host: 192.168.1.11
          ansible_user: ubuntu
      vars:
        nginx_port: 80
        environment: production
    
    databases:
      hosts:
        db01:
          ansible_host: 192.168.1.20
          ansible_user: ubuntu
          mysql_root_password: "{{ vault_mysql_root_password }}"
      vars:
        mysql_port: 3306
        
  vars:
    ansible_ssh_private_key_file: ~/.ssh/id_rsa
    ansible_python_interpreter: /usr/bin/python3
```

### 5-2. INI 형식 인벤토리

```ini
# inventory/staging/inventory.ini
[webservers]
web01 ansible_host=10.0.1.10 ansible_user=ubuntu
web02 ansible_host=10.0.1.11 ansible_user=ubuntu

[databases]
db01 ansible_host=10.0.1.20 ansible_user=ubuntu

[webservers:vars]
nginx_port=8080
environment=staging

[all:vars]
ansible_ssh_private_key_file=~/.ssh/staging_key
ansible_python_interpreter=/usr/bin/python3
```

## 6. Playbook과 Roles 작성 예시

### 6-1. 기본 플레이북 구조

```yaml
# playbooks/webserver.yml
---
- name: Configure web servers
  hosts: webservers
  become: yes
  vars:
    app_name: myapp
    
  pre_tasks:
    - name: Update package cache
      apt:
        update_cache: yes
      when: ansible_os_family == "Debian"
        
  roles:
    - common
    - nginx
    - ssl_certificates
    
  post_tasks:
    - name: Ensure nginx is started
      service:
        name: nginx
        state: started
        enabled: yes
        
  handlers:
    - name: restart nginx
      service:
        name: nginx
        state: restarted
```

### 6-2. Role 구조 예시

```
roles/nginx/
├── defaults/
│   └── main.yml          # 기본 변수
├── files/
│   └── nginx.conf        # 정적 파일
├── handlers/
│   └── main.yml          # 핸들러 정의
├── meta/
│   └── main.yml          # Role 메타데이터
├── tasks/
│   └── main.yml          # 주요 작업들
├── templates/
│   └── vhost.conf.j2     # Jinja2 템플릿
├── tests/
│   ├── inventory
│   └── test.yml          # 테스트 플레이북
└── vars/
    └── main.yml          # Role 변수
```

<b>`roles/nginx/tasks/main.yml` 예시</b>
```yaml
---
- name: Install nginx
  package:
    name: nginx
    state: present
  notify: restart nginx

- name: Create nginx config from template
  template:
    src: vhost.conf.j2
    dest: "/etc/nginx/sites-available/{{ server_name }}"
    backup: yes
  notify: restart nginx

- name: Enable site
  file:
    src: "/etc/nginx/sites-available/{{ server_name }}"
    dest: "/etc/nginx/sites-enabled/{{ server_name }}"
    state: link
  notify: restart nginx
```

## 7. 기본 명령어

### 7-1. 실행 관련 명령어

```bash
# 플레이북 실행
ansible-playbook -i inventory/production/inventory.yml playbooks/webserver.yml

# 특정 태그만 실행
ansible-playbook -i inventory.yml playbook.yml --tags "nginx,ssl"

# 특정 태그 제외하고 실행
ansible-playbook -i inventory.yml playbook.yml --skip-tags "database"

# Dry-run (실제 실행하지 않고 확인만)
ansible-playbook -i inventory.yml playbook.yml --check

# 특정 호스트만 대상으로 실행
ansible-playbook -i inventory.yml playbook.yml --limit "web01,web02"
```

### 7-2. 변수 확인 명령어

```bash
# 특정 호스트의 모든 변수 확인
ansible -i inventory.yml web01 -m debug -a "var=vars"

# 특정 변수값 확인
ansible -i inventory.yml webservers -m debug -a "var=nginx_port"

# Extra vars 사용
ansible-playbook -i inventory.yml playbook.yml -e "nginx_port=9090"

# 변수 파일 사용
ansible-playbook -i inventory.yml playbook.yml -e "@extra_vars.yml"
```

### 7-3. 문법 검사 및 테스트

```bash
# YAML 문법 검사
ansible-playbook --syntax-check playbook.yml

# 인벤토리 문법 검사
ansible-inventory -i inventory.yml --list

# 연결 테스트
ansible -i inventory.yml all -m ping

# 애드혹 명령 실행
ansible -i inventory.yml webservers -m shell -a "uptime"

# Vault 파일 편집
ansible-vault edit secrets.yml

# Vault 파일로 플레이북 실행
ansible-playbook -i inventory.yml playbook.yml --ask-vault-pass
```

## 8. 실무 팁

### 8-1. 디버깅

```bash
# 상세한 로그 출력
ansible-playbook -i inventory.yml playbook.yml -vvv

# 특정 작업부터 시작
ansible-playbook -i inventory.yml playbook.yml --start-at-task "Install nginx"

# 실패한 호스트만 재실행
ansible-playbook -i inventory.yml playbook.yml --limit @retry_hosts.txt
```

### 8-2. 성능 최적화

```bash
# 병렬 실행 수 조정
ansible-playbook -i inventory.yml playbook.yml --forks 10

# SSH 연결 재사용 설정 (ansible.cfg)
[ssh_connection]
ssh_args = -o ControlMaster=auto -o ControlPersist=60s
pipelining = True
```

> [!IMPORTANT]
> 프로덕션에서는 반드시 `--check`로 Dry-run을 한 번 돌려보고 실제 변경을 하자. 설정 변경이나 서비스 재시작이 끼어 있으면 특히 그렇다.

## 9. 참고
- [Ansible Best Practices](https://docs.ansible.com/ansible/2.8/user_guide/playbooks_best_practices.html)
- [Ansible Galaxy Role Naming Rules](https://ansible.readthedocs.io/projects/lint/rules/role-name/)
- [Kubespray Snake Case 전환 이슈](https://github.com/kubernetes-sigs/kubespray/issues/12195)
- [Ansible Variables 공식 문서](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_variables.html)
- [Ansible Galaxy 공식 사이트](https://galaxy.ansible.com/ui/)
