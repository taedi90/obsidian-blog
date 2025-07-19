---
title: Ansible 구조
date: 2025-07-16
draft: true
tags: 
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed: 
type:
  - note
---

ansible 을 도입하면서 처음에 엄청 난항을 겪었는데, 폴더 구조 다양성을 줄 수 있고, 변수도 여러곳에서 지정이 가능한 등 굉장히 자유도가 높고 기능이 많았다.

모든 내용을 다 파악하지는 못했고 딱 사용할만큼만 알아보았다.

## 폴더 구조


<< 각 폴더 및 파일의 용도 >>


kubespray 는 최근에 role 과 task 폴더를 케밥케이스에서 스네이크 케이스로 바꿨더라
따라하기로 결심했다

## ansible-galaxy
## 변수 우선순위
변수는 엄청 다양한 곳에서 정의가 가능하다.
<< 변수 정의 예시를 추가해줘 >>

- 변수 적용 순서
    
    1. 역할 기본값 (`role/defaults/main.yml`)
        
    2. 인벤토리 그룹 변수 (`group_vars`, inventory 내 group)
        
    3. 인벤토리 호스트 변수 (`host_vars`, inventory 내 host)
        
    4. 플레이북 내 변수 (vars, vars_prompt, vars_files 등)
        
    5. 역할 변수 (`role/vars/main.yml`)
        
    6. 블록 변수, 태스크 변수, include_vars, set_fact
        
    7. Extra-vars (`-e` 옵션, 명령행 추가 변수) — **최고 우선순위**

<< 변수가 어떻게 적용되는지 미리 확인할 수 있는 명령어도 알려줘 >>

기본 명령어

## 참고
- https://docs.ansible.com/ansible/2.8/user_guide/playbooks_best_practices.html
- https://ansible.readthedocs.io/projects/lint/rules/role-name/
- https://github.com/kubernetes-sigs/kubespray/issues/12195
- https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_variables.html